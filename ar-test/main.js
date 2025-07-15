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
    geometry.setAttribute('position', new
