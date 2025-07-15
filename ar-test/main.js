import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

import { FACEMESH_TESSELATION, UV_COORDS } from './face_mesh_data.js';

let scene, camera, renderer;
let video, faceLandmarker, runningMode = "VIDEO";
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let debugCube; // Declare debugCube

const NUM_LANDMARKS = UV_COORDS.length;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

async function init() {
    console.log("init() started.");

    // 1. Setup Three.js Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xAAAAAA); // Set a visible background color for debugging
    console.log("Scene created.");

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 100; // Keep this consistent for now
    console.log("Camera created. Position Z:", camera.position.z);

    const outputCanvasElement = document.getElementById('outputCanvas');
    if (!outputCanvasElement) {
        console.error("ERROR: 'outputCanvas' element not found in HTML!");
        document.getElementById('loading').innerText = "Error: Canvas not found.";
        return;
    }
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas: outputCanvasElement });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement); // This is already present, ensures it's in the DOM
    console.log("Renderer created and attached to canvas.");

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    console.log("Ambient light added.");

    // Add directional light for better shading
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(0, 0, 1).normalize();
    scene.add(directionalLight);
    console.log("Directional light added.");

    // *** RE-ADD THE DEBUG CUBE HERE ***
    const debugGeometry = new THREE.BoxGeometry(20, 20, 20); // Make it slightly larger to ensure visibility
    const debugMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
    debugCube = new THREE.Mesh(debugGeometry, debugMaterial);
    debugCube.position.set(0, 0, 0); // Place it at the center of the scene
    scene.add(debugCube);
    console.log("Debug cube added to scene at (0,0,0).");
    // **********************************

    // 2. Setup Webcam Video
    video = document.getElementById('webcamVideo');
    console.log("Webcam video element:", video); // Check if video element is found
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                console.log("Webcam video metadata loaded and playing.");
                resolve();
            };
            video.onerror = (e) => {
                console.error("Video element error:", e);
                document.getElementById('loading').innerText = "Error: Video load error.";
            };
        });
        video.width = VIDEO_WIDTH;
        video.height = VIDEO_HEIGHT;
    } catch (error) {
        console.error("Error accessing webcam:", error);
        document.getElementById('loading').innerText = "Error: Webcam access denied or failed. Please ensure camera permissions are granted.";
        return;
    }

    // 3. Initialize MediaPipe Face Landmarker
    console.log("Loading MediaPipe model...");
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: runningMode,
        numFaces: 1
    });
    console.log("MediaPipe FaceLandmarker loaded.");

    document.getElementById('loading').style.display = 'none';

    // 4. Create Three.js Face Mesh (Geometry)
    // ... (rest of mesh setup - positions, uvs, indices, material) ...
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(NUM_LANDMARKS * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const uvs = new Float32Array(NUM_LANDMARKS * 2);
    for (let i = 0; i < NUM_LANDMARKS; i++) {
        uvs[i * 2 + 0] = UV_COORDS[i].x;
        uvs[i * 2 + 1] = UV_COORDS[i].y;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const indices = new Uint16Array(FACEMESH_TESSELATION);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.morphAttributes.position = [];
    geometry.morphTargets = true;

    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 512;
    textureCanvas.height = 512;
    textureCanvasCtx = textureCanvas.getContext('2d');

    faceTexture = new THREE.CanvasTexture(textureCanvas);
    faceTexture.minFilter = THREE.LinearFilter;
    faceTexture.magFilter = THREE.LinearFilter;
    faceTexture.encoding = THREE.sRGBEncoding;

    const material = new THREE.MeshStandardMaterial({
        map: faceTexture,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.1
    });

    faceMesh = new THREE.Mesh(geometry, material);
    faceMesh.visible = false; // Start hidden until face detected
    scene.add(faceMesh);
    console.log("Face mesh created and added to scene (initially hidden).");

    // Start the animation loop
    animate();
    console.log("init() finished, animation loop started.");
}

let lastVideoTime = -1;
async function animate() {
    requestAnimationFrame(animate);

    // Optional: Rotate the debug cube to confirm render loop is active
    if (debugCube) {
        debugCube.rotation.x += 0.005;
        debugCube.rotation.y += 0.005;
    }

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        if (lastVideoTime !== video.currentTime) {
            lastVideoTime = video.currentTime;
            const results = await faceLandmarker.detectForVideo(video, performance.now());

            if (results && results.faceLandmarks && results.faceLandmarks.length > 0 &&
                results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0 &&
                results.facialTransformationMatrixes[0] && results.facialTransformationMatrixes[0].matrix) {

                faceMesh.visible = true; // Make face mesh visible when a face is found
                if (debugCube) debugCube.visible = false; // Hide debug cube once face is found

                const faceLandmarks = results.faceLandmarks[0];
                const blendshapes = results.faceBlendshapes && results.faceBlendshapes.length > 0 ? results.faceBlendshapes[0] : null;
                const transformMatrix = results.facialTransformationMatrixes[0].matrix;

                // console.log("Face detected. Transform Matrix:", transformMatrix); // Uncomment for matrix debug

                // 1. Update Mesh Positions using normalized landmarks
                const positions = faceMesh.geometry.attributes.position.array;
                for (let i = 0; i < NUM_LANDMARKS; i++) {
                    const landmark = faceLandmarks[i];
                    positions[i * 3 + 0] = (landmark.x - 0.5) * VIDEO_WIDTH / 100;
                    positions[i * 3 + 1] = -(landmark.y - 0.5) * VIDEO_HEIGHT / 100;
                    positions[i * 3 + 2] = landmark.z * VIDEO_WIDTH / 100;
                }
                faceMesh.geometry.attributes.position.needsUpdate = true;
                faceMesh.geometry.computeVertexNormals();

                // 2. Apply Blendshapes (if applicable, currently placeholder for procedural mesh)
                if (blendshapes && faceMesh.morphTargetInfluences) {
                     for (const blendshape of blendshapes.categories) {
                         const { categoryName, score } = blendshape;
                         if (faceMesh.morphTargetDictionary && faceMesh.morphTargetDictionary[categoryName] !== undefined) {
                             faceMesh.morphTargetInfluences[faceMesh.morphTargetDictionary[categoryName]] = score;
                         }
                     }
                }

                // 3. Apply Transformation Matrix for global pose
                const scaleFactor = 150;
                const threeMatrix = new THREE.Matrix4().fromArray(transformMatrix);
                threeMatrix.multiply(new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor));
                faceMesh.matrix.copy(threeMatrix);
                faceMesh.matrixAutoUpdate = false;
                faceMesh.matrixWorldNeedsUpdate = true;

                // Generate Face Texture
                drawFaceTexture(faceLandmarks, video.videoWidth, video.videoHeight);
                faceTexture.needsUpdate = true;

            } else {
                // No face detected, or data not available.
                faceMesh.visible = false; // Hide face mesh
                if (debugCube) debugCube.visible = true; // Show debug cube if no face
            }
        }
    }

    renderer.render(scene, camera);
}

function drawFaceTexture(faceLandmarks, videoWidth, videoHeight) {
    if (!textureCanvasCtx || !video) return;

    textureCanvasCtx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < NUM_LANDMARKS; i++) {
        const landmark = faceLandmarks[i];
        const px = landmark.x * videoWidth;
        const py = landmark.y * videoHeight;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
    }

    const padding = (maxX - minX) * 0.1;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(videoWidth, maxX + padding);
    maxY = Math.min(videoHeight, maxY + padding);

    const cropWidth = maxX - minX;
    const cropHeight = maxY - minY;

    if (cropWidth <= 0 || cropHeight <= 0) {
        return;
    }

    textureCanvasCtx.save();
    textureCanvasCtx.translate(textureCanvas.width, 0);
    textureCanvasCtx.scale(-1, 1);

    textureCanvasCtx.drawImage(
        video,
        minX, minY, cropWidth, cropHeight,
        0, 0, textureCanvas.width, textureCanvas.height
    );
    textureCanvasCtx.restore();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
