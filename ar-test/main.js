// NO MORE IMPORTS - All libraries are loaded from index.html

(function() {
    // --- ON-SCREEN CONSOLE OVERRIDE ---
    const originalLog = console.log;
    function appendToConsole(message, type = 'log') {
        const consoleDiv = document.getElementById('onScreenConsole');
        if (!consoleDiv) return;
        const p = document.createElement('p');
        p.textContent = `[${type.toUpperCase()}] ${message}`;
        p.style.margin = '0';
        p.style.lineHeight = '1.2em';
        if (type === 'warn') p.style.color = 'yellow';
        if (type === 'error') p.style.color = 'red';
        consoleDiv.appendChild(p);
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
    console.log = function(...args) {
        originalLog.apply(console, args);
        appendToConsole(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' '), 'log');
    };
})();


import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Correctly import the specific classes you need from MediaPipe
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
//import { FACEMESH_TESSELATION, UV_COORDS } from './face_mesh_data.js';

let scene, camera, renderer;
let video, faceLandmarker, runningMode = "VIDEO";
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let debugCube;
let exportedMeshData = null;
let ARRocksInitialised = false;

// FACEMESH_TESSELATION and UV_COORDS are loaded from face_mesh_data.js
const NUM_LANDMARKS = UV_COORDS.length;
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

async function init() {
    console.log("init() started.");

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2;

    const outputCanvasElement = document.getElementById('outputCanvas');
    renderer = new THREE.WebGLRenderer({ canvas: outputCanvasElement, antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(0, 1, 1).normalize();
    scene.add(directionalLight);

    const debugGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const debugMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
    debugCube = new THREE.Mesh(debugGeometry, debugMaterial);
    scene.add(debugCube);

    video = document.getElementById('webcamVideo');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = stream;
        await new Promise((resolve) => { video.onloadedmetadata = () => { video.play(); resolve(); }; });
        video.width = VIDEO_WIDTH;
        video.height = VIDEO_HEIGHT;
    } catch (error) {
        console.error("Error accessing webcam:", error);
        document.getElementById('loading').innerText = "Error: Webcam access denied.";
        return;
    }

    const visionResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(visionResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "CPU" },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: runningMode,
        numFaces: 1,
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NUM_LANDMARKS * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(UV_COORDS.flatMap(coord => [coord.x, 1 - coord.y])), 2));
    geometry.setIndex(FACEMESH_TESSELATION.flat());

    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 512;
    textureCanvas.height = 512;
    textureCanvasCtx = textureCanvas.getContext('2d');
    faceTexture = new THREE.CanvasTexture(textureCanvas); // Use CanvasTexture
    const material = new THREE.MeshStandardMaterial({ map: faceTexture, side: THREE.DoubleSide });
    faceMesh = new THREE.Mesh(geometry, material);
    scene.add(faceMesh);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.getElementById('saveButton').style.display = 'block';
    document.getElementById('saveButton').addEventListener('click', saveMesh);

    const arButtonPlaceholder = document.getElementById('arButtonPlaceholder');
    const startARButton = document.createElement('button');
    startARButton.textContent = 'START AR';
    Object.assign(startARButton.style, {
        position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '100', padding: '12px 24px', border: '1px solid white', borderRadius: '4px',
        background: 'rgba(0,0,0,0.5)', color: 'white', cursor: 'pointer', fontSize: '16px'
    });
    startARButton.onclick = () => {
        startARButton.style.display = 'none';
        mainWebARRocks();
    };
    arButtonPlaceholder.appendChild(startARButton);

    document.getElementById('loading').style.display = 'none';
    animate();
}

function saveMesh() {
    if (!faceMesh || !faceMesh.visible) { console.warn("No visible face mesh to save."); return; }
    const exporter = new GLTFExporter();
    exporter.parse(faceMesh, (gltfData) => {
        exportedMeshData = gltfData;
        console.log("Mesh exported to GLTF in memory.");
        alert("Face mesh saved to memory! Ready for AR.");
    }, (error) => { console.error('GLTF export error:', error); }, { embedImages: true, binary: true });
}

let lastVideoTime = -1;
function animate() {
    requestAnimationFrame(animate);
    if (ARRocksInitialised) {
        WebARRocksObjectThreeHelper.animate();
    }
    render();
}

function render() {
    faceMesh.visible = !ARRocksInitialised;
    debugCube.visible = !ARRocksInitialised && !faceMesh.visible;
    if (ARRocksInitialised) {
        scene.background = null;
        renderer.setClearAlpha(0);
    } else {
        scene.background = new THREE.Color(0x333333);
        if (video.readyState === video.HAVE_ENOUGH_DATA && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            const results = faceLandmarker.detectForVideo(video, performance.now());
            if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
                const landmarks = results.faceLandmarks[0];
                const positions = faceMesh.geometry.attributes.position.array;
                const uvs = faceMesh.geometry.attributes.uv.array;
                for (let i = 0; i < landmarks.length; i++) {
                    positions[i * 3] = (landmarks[i].x - 0.5) * 2;
                    positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
                    positions[i * 3 + 2] = -landmarks[i].z;
                    uvs[i*2] = landmarks[i].x;
                    uvs[i*2+1] = 1.0 - landmarks[i].y;
                }
                faceMesh.geometry.attributes.position.needsUpdate = true;
                faceMesh.geometry.attributes.uv.needsUpdate = true;
                faceMesh.geometry.computeVertexNormals();
                textureCanvasCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
                textureCanvasCtx.drawImage(video, 0, 0, textureCanvas.width, textureCanvas.height);
                faceTexture.needsUpdate = true; // Tell Three.js to update the texture from the canvas
            }
        }
    }
    renderer.render(scene, camera);
}

let _DOMVideo = null;
function mainWebARRocks(){
    _DOMVideo = document.getElementById('webcamVideo');
    if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }
    WebARRocksMediaStreamAPIHelper.get(_DOMVideo, initWebARRocks, (err) => {
        console.error('Cannot get video feed for WebARRocks:', err);
    }, { video: { facingMode: {ideal: 'environment'} } });
}

function initWebARRocks(){
  // ...
  WebARRocksObjectThreeHelper.init({
    video: _DOMVideo,
    ARCanvas: document.getElementById('ARCanvas'),
    threeCanvas: document.getElementById('threeCanvas'),
    callbackReady: function(){
        ARRocksInitialised = true; // <-- ADD THIS LINE HERE
        startWebARRocks();
    }
  });
}

function startWebARRocks(){
    if (exportedMeshData) {
        const loader = new GLTFLoader();
        loader.parse(exportedMeshData, (gltf) => {
            const loadedMesh = gltf.scene;
            loadedMesh.scale.set(0.2, 0.2, 0.2); // Adjust scale for AR
            WebARRocksObjectThreeHelper.add('KEYBOARD', loadedMesh);
        });
    } else {
        const s = 0.5;
        const debugCubeAR = new THREE.Mesh( new THREE.BoxGeometry(s,s,s), new THREE.MeshNormalMaterial());
        debugCubeAR.position.set(0, s/2, 0);
        WebARRocksObjectThreeHelper.add('KEYBOARD', debugCubeAR);
    }
}

// Start the application
init();