// main.js - Hybrid Module Version

// Use import for module-based libraries
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { WebARRocksObjectThreeHelper } from './helpers/WebARRocksObjectThreeHelper.js';


window.THREE = THREE;


// These are global, loaded from face_mesh_data.js classic script
import { FACEMESH_TESSELATION, UV_COORDS } from './face_mesh_data.js';
const NUM_LANDMARKS = UV_COORDS.length;

// Global variables for the app
let scene, camera, renderer, video, faceLandmarker;
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let exportedMeshData = null;
let ARRocksInitialised = false;
const runningMode = "VIDEO";
let animationFrameId;

const _settings = {
  NNPath: './neuralNets/NN_KEYBOARD_5.json'
};

async function init() {
    console.log("init() started.");

    // Setup Scene for MediaPipe phase
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2;
    const canvas = document.getElementById('outputCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(0, 1, 1);
    scene.add(dirLight);

    // Setup MediaPipe
    video = document.getElementById('webcamVideo');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });

    const visionResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(visionResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
        runningMode,
        numFaces: 1
    });

    // Setup Face Mesh object
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NUM_LANDMARKS * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(NUM_LANDMARKS * 2), 2));
    geometry.setIndex(FACEMESH_TESSELATION.flat());
    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 512;
    textureCanvas.height = 512;
    textureCanvasCtx = textureCanvas.getContext('2d');
    faceTexture = new THREE.CanvasTexture(textureCanvas);
    const material = new THREE.MeshStandardMaterial({ map: faceTexture, side: THREE.DoubleSide });
    faceMesh = new THREE.Mesh(geometry, material);
    scene.add(faceMesh);

    // Setup UI
    document.getElementById('loading').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'flex';
    document.getElementById('saveButton').addEventListener('click', saveMesh);
    document.getElementById('arButton').addEventListener('click', mainWebARRocks);

    animate();
}

function saveMesh() {
    const results = faceLandmarker.detectForVideo(video, performance.now());
    if (results.faceLandmarks.length === 0) {
        alert("No face detected. Please try again.");
        return;
    }

    const landmarks = results.faceLandmarks[0];
    const positions = faceMesh.geometry.attributes.position.array;
    for (let i = 0; i < landmarks.length; i++) {
        positions[i * 3]     = (landmarks[i].x - 0.5) * 2;
        positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
        positions[i * 3 + 2] = -landmarks[i].z;
    }
    faceMesh.geometry.attributes.position.needsUpdate = true;
    faceMesh.geometry.computeVertexNormals();

    const exporter = new GLTFExporter();
    exporter.parse(faceMesh, (gltf) => {
        exportedMeshData = gltf;
        alert("Face mesh saved! You can now start AR.");
        document.getElementById('arButton').style.display = 'block';
    }, (error) => console.error(error), { binary: true });
}


let lastVideoTime = -1;

function animate() {
    if (ARRocksInitialised) {
        // Stop this loop once AR starts; the AR helper has its own loop
        return;
    }
    animationFrameId = requestAnimationFrame(animate);
    render();
}

function render() {
    // This is the pre-AR rendering logic
    if (video && faceLandmarker && video.readyState === video.HAVE_ENOUGH_DATA) {
        if (video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            const results = faceLandmarker.detectForVideo(video, performance.now());

            if (results.faceLandmarks.length > 0) {
                faceMesh.visible = true; // Make the mesh visible

                const landmarks = results.faceLandmarks[0];
                const positions = faceMesh.geometry.attributes.position.array;
                const uvs = faceMesh.geometry.attributes.uv.array; // Get the UV buffer

                // Update vertex positions and UVs based on landmarks
                for (let i = 0; i < landmarks.length; i++) {
                    positions[i * 3]     = (landmarks[i].x - 0.5) * 2;
                    positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
                    positions[i * 3 + 2] = -landmarks[i].z;
                    
                    // --- ADDED: Update UV coordinates ---
                    uvs[i * 2]     = landmarks[i].x;
                    uvs[i * 2 + 1] = 1.0 - landmarks[i].y; // Flip Y for correct mapping
                }
                
                faceMesh.geometry.attributes.position.needsUpdate = true;
                faceMesh.geometry.attributes.uv.needsUpdate = true; // Flag the UV buffer for update
                faceMesh.geometry.computeVertexNormals();

                // Update the texture to show the camera feed on the mesh
                textureCanvasCtx.clearRect(0, 0, 512, 512);
                textureCanvasCtx.drawImage(video, 0, 0, 512, 512);
                faceTexture.needsUpdate = true;

            } else {
                faceMesh.visible = false; // Hide if no face is detected
            }
        }
    }

    // Render the scene in every frame
    renderer.render(scene, camera);
}

let _DOMVideo;
function mainWebARRocks() {

   // --- CRUCIAL CLEANUP STEP ---
    cancelAnimationFrame(animationFrameId); // Stop the first animation loop
    if (renderer) renderer.dispose(); // Dispose of the first renderer
    if (scene) scene.clear(); // Clear the old scene
    document.getElementById('outputCanvas').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'none';
    // --- END CLEANUP ---
  
    ARRocksInitialised = true;
    renderer.setAnimationLoop(null); // Stop the old render loop
    document.getElementById('uiContainer').style.display = 'none';
    document.getElementById('outputCanvas').style.display = 'none'; // <-- ADD THIS LINE

    _DOMVideo = document.getElementById('webcamVideo');
    if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }
    
    // Access classic script helpers via the 'window' object
    window.WebARRocksMediaStreamAPIHelper.get(_DOMVideo, initWebARRocks, (err) => console.error(err), { video: { facingMode: { ideal: 'environment' } } });
}

function initWebARRocks() {
    document.getElementById('ARCanvas').style.display = 'block';
    document.getElementById('threeCanvas').style.display = 'block';


    // Access classic script helper via the 'window' object
    window.WebARRocksObjectThreeHelper.init({
        video: _DOMVideo,
        ARCanvas: document.getElementById('ARCanvas'),
        threeCanvas: document.getElementById('threeCanvas'),
        NNPath: _settings.NNPath,
        callbackReady: startWebARRocks
    });
}

function startWebARRocks(err, three) {
    if (err) {
        console.error("Error in WebAR.rocks initialization:", err);
        return;
    }

    // Add lighting to the AR Scene
    three.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const arDirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    arDirLight.position.set(0, 1, 1);
    three.scene.add(arDirLight);

    if (exportedMeshData) {
        const loader = new GLTFLoader();

        // CORRECT: Pass an empty string for the path (2nd argument),
        // so your callback is the 3rd argument (onLoad).
        loader.parse(exportedMeshData, '', function (gltf) {
            const loadedMesh = gltf.scene;
            loadedMesh.scale.set(0.2, 0.2, 0.2);
            // Access classic script helper via the 'window' object
            WebARRocksObjectThreeHelper.add('KEYBOARD', loadedMesh);
        }, function (error) {
            console.error('An error happened during GLTF parsing:', error);
        });

    } else {
        // Fallback to a cube if no mesh was saved
        const arCube = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshNormalMaterial());
        WebARRocksObjectThreeHelper.add('KEYBOARD', arCube);
        alert("No mesh data found, showing a debug cube instead.");
    }

    // Start the new AR animation loop
    function animateAR() {
        WebARRocksObjectThreeHelper.animate();
        requestAnimationFrame(animateAR);
    }
    animateAR();
}

// Start the application
init();
