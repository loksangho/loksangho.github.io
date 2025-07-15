import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

import { FACEMESH_TESSELATION, UV_COORDS } from './face_mesh_data.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js'; // Add this at the top of main.js

let scene, camera, renderer;
let video, faceLandmarker, runningMode = "VIDEO";
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let debugCube;
let meshBoxHelper;

const NUM_LANDMARKS = UV_COORDS.length;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;
let normalsHelper; // Declare this near your other global variables


// === Removed DOMContentLoaded listener, rely on window.onload from index.html ===
// No direct init() call here in main.js
// ==============================================================================

async function init() {
    console.log("init() started.");

    // 1. Setup Three.js Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);
    console.log("Scene created.");

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;
    console.log("Camera created. Position Z:", camera.position.z);

    const outputCanvasElement = document.getElementById('outputCanvas');
    if (!outputCanvasElement) {
        console.error("ERROR: 'outputCanvas' element not found in HTML! This is why rendering fails.");
        document.getElementById('loading').innerText = "Error: Canvas not found.";
        return;
    }
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas: outputCanvasElement, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);
    console.log("Renderer created and attached to canvas.");

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    console.log("Ambient light added.");

    // Add directional light for better shading
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(0, 0, 1).normalize();
    scene.add(directionalLight);
    console.log("Directional light added.");

    // Debug Cube
    const debugGeometry = new THREE.BoxGeometry(20, 20, 20);
    const debugMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
    debugCube = new THREE.Mesh(debugGeometry, debugMaterial);
    debugCube.position.set(0, 0, 0);
    scene.add(debugCube);
    console.log("Debug cube added to scene at (0,0,0).");

    // 2. Setup Webcam Video
    video = document.getElementById('webcamVideo');
    console.log("Webcam video element:", video);
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
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
            // *** IMPORTANT: Try explicitly setting delegate to CPU ***
            delegate: "CPU" // Changed from "GPU" to "CPU" for mobile debugging
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: runningMode,
        numFaces: 1,
        // *** LOWER THESE FOR DEBUGGING DETECTION ***
        minDetectionConfidence: 0.05, // Try extremely low for testing
        minFacePresenceConfidence: 0.05, // Try extremely low for testing
        minTrackingConfidence: 0.05 // Try extremely low for testing
        // ***************************************
    });
    console.log("MediaPipe FaceLandmarker loaded.");

    document.getElementById('loading').style.display = 'none';

    // 4. Create Three.js Face Mesh (Geometry)
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
    //geometry.morphAttributes.position = [];
    //geometry.morphTargets = true;

    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NUM_LANDMARKS * 3), 3));
    
    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 512;
    textureCanvas.height = 512;
    textureCanvasCtx = textureCanvas.getContext('2d');

    faceTexture = new THREE.CanvasTexture(textureCanvas);
    faceTexture.minFilter = THREE.LinearFilter;
    faceTexture.magFilter = THREE.LinearFilter;
    faceTexture.encoding = THREE.sRGBEncoding;
    faceTexture.flipY = false;

    /*const material = new THREE.MeshBasicMaterial({
        color: 0x0000FF, // Blue color for testing
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.1,
    });*/
    const material = new THREE.MeshStandardMaterial({
        map: faceTexture, // Re-enable the texture mapping
        side: THREE.DoubleSide,
        wireframe: true,
        // transparent: true, // Keep transparent if alphaTest is needed, or for blendshape-style transparency
        // alphaTest: 0.1,    // Keep if you have parts of texture with low alpha you want to discard
        // color: 0x0000FF, // Remove the test color
        // wireframe: true // Remove wireframe unless you want it for visual effect
    });

    faceMesh = new THREE.Mesh(geometry, material);
    faceMesh.visible = false;
    scene.add(faceMesh);
    console.log("Face mesh created and added to scene (initially hidden).");

    // Add a BoxHelper for the face mesh to visualize its bounding box
    meshBoxHelper = new THREE.BoxHelper(faceMesh, 0xFF0000);
    scene.add(meshBoxHelper);
    meshBoxHelper.visible = false;
    console.log("Face mesh BoxHelper added (initially hidden).");


    normalsHelper = new VertexNormalsHelper(faceMesh, 2, 0x00FF00); // Mesh, size of arrows, color (green)
    scene.add(normalsHelper);
    normalsHelper.visible = false; // Initially hidden
    
     // *** ADD THE RESIZE LISTENER HERE ***
    window.addEventListener('resize', () => {
        if (camera && renderer) { // Add a check to be extra safe, though it should be defined here
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            console.log("Window resized. Renderer and camera updated.");
        }
    });

    // Start the animation loop
    animate();
    console.log("init() finished, animation loop started.");
}

let lastVideoTime = -1;
// ... (animate function) ...
async function animate() {
    requestAnimationFrame(animate);

    if (debugCube) {
        debugCube.rotation.x += 0.005;
        debugCube.rotation.y += 0.005;
    }

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        if (lastVideoTime !== video.currentTime) {
            lastVideoTime = video.currentTime;

            // ... (console.logs for video state) ...

            const results = await faceLandmarker.detectForVideo(video, performance.now());

            // ... (console.logs for MediaPipe Results) ...

            // *** CRITICAL CHANGE TO THE IF CONDITION AND transformMatrix ACCESS ***
            if (results && results.faceLandmarks && results.faceLandmarks.length > 0 &&
                results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0 &&
                results.facialTransformationMatrixes[0] && results.facialTransformationMatrixes[0].data && // CHECK FOR '.data' HERE
                results.facialTransformationMatrixes[0].data.length === 16) { // ADD LENGTH CHECK FOR ROBUSTNESS

                // Hide debug cube, show face mesh and its helper
                if (debugCube) debugCube.visible = false;
                faceMesh.visible = true;
                if (meshBoxHelper) meshBoxHelper.visible = true;
                if (normalsHelper) normalsHelper.visible = true;

                
                console.log("FACE DETECTED! Processing mesh..."); // Confirmation log

                const faceLandmarks = results.faceLandmarks[0];
                const blendshapes = results.faceBlendshapes && results.faceBlendshapes.length > 0 ? results.faceBlendshapes[0] : null;
                // *** CHANGE THIS LINE TO USE '.data' ***
                const transformMatrix = results.facialTransformationMatrixes[0].data; // Use the 'data' property
                // ****************************************

                // 1. Update Mesh Positions using normalized landmarks
                const positions = faceMesh.geometry.attributes.position.array;
                for (let i = 0; i < NUM_LANDMARKS; i++) {
                    const landmark = faceLandmarks[i];
                    positions[i * 3 + 0] = landmark.x;
                    positions[i * 3 + 1] = landmark.y;
                    positions[i * 3 + 2] = landmark.z;
                }
                faceMesh.geometry.attributes.position.needsUpdate = true;
                faceMesh.geometry.computeVertexNormals();
                if (normalsHelper) normalsHelper.update();
                faceMesh.geometry.computeBoundingBox();
                faceMesh.geometry.computeBoundingSphere();

                

                // 2. Apply Blendshapes (placeholder)
                /*if (blendshapes && faceMesh.morphTargetInfluences) {
                     for (const blendshape of blendshapes.categories) {
                         const { categoryName, score } = blendshape;
                         if (faceMesh.morphTargetDictionary && faceMesh.morphTargetDictionary[categoryName] !== undefined) {
                             faceMesh.morphTargetInfluences[faceMesh.morphTargetDictionary[categoryName]] = score;
                         }
                     }
                }*/

                // 3. Apply Transformation Matrix for global pose
                const scaleFactor = 100; // Keep experimenting with this value if needed
                const threeMatrix = new THREE.Matrix4().fromArray(transformMatrix); // This should now work!
                threeMatrix.multiply(new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor));
                threeMatrix.multiply(new THREE.Matrix4().makeScale(1, -1, 1)); // Flip Y-axis

                faceMesh.matrix.copy(threeMatrix);
                faceMesh.matrixAutoUpdate = false;
                faceMesh.matrixWorldNeedsUpdate = true;

                // Inside the 'if (results && results.faceLandmarks ...)' block in animate()
                // after faceMesh.matrixWorldNeedsUpdate = true;
                
                // --- Live Debugging Logs ---
                const worldPosition = new THREE.Vector3();
                faceMesh.updateWorldMatrix(true, false); // Ensure world matrix is updated for correct position extraction
                worldPosition.setFromMatrixPosition(faceMesh.matrixWorld);
                console.log("Face Mesh World Position (XYZ):", worldPosition.x, worldPosition.y, worldPosition.z);
                
                if (faceMesh.geometry.boundingBox) {
                    faceMesh.geometry.boundingBox.applyMatrix4(faceMesh.matrixWorld); // Apply world matrix to bounding box
                    const size = faceMesh.geometry.boundingBox.getSize(new THREE.Vector3());
                    console.log("Face Mesh World Size (XYZ):", size.x, size.y, size.z);
                    console.log("Face Mesh World Bounding Box Min/Max:", faceMesh.geometry.boundingBox.min, faceMesh.geometry.boundingBox.max);
                }
                // ---------------------------

                const diagnosticMaterial = new THREE.MeshBasicMaterial({
                    color: 0xFF0000, // Bright red
                    wireframe: true, // Render only the edges of triangles
                    side: THREE.DoubleSide // Ensure both sides are drawn
                });
                // In your animate loop, temporarily apply this material to faceMesh
                 faceMesh.material = diagnosticMaterial;
                
                if (meshBoxHelper) {
                    meshBoxHelper.update();
                }

                // Generate Face Texture
                drawFaceTexture(faceLandmarks, video.videoWidth, video.videoHeight);
                faceTexture.needsUpdate = true;

            } else {
                // No face detected, or data not available.
                faceMesh.visible = false;
                if (meshBoxHelper) meshBoxHelper.visible = false;
                if (debugCube) debugCube.visible = true; // Show debug cube if no face
                // Optionally log why it's not detecting:
                // if (results && results.faceLandmarks && results.faceLandmarks.length === 0) {
                //    console.log("No faces detected in this frame (faceLandmarks empty).");
                // } else if (results && results.facialTransformationMatrixes && results.facialTransformationMatrixes.length === 0) {
                //    console.log("No transformation matrixes in this frame.");
                // }
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
    //textureCanvasCtx.translate(textureCanvas.width, 0);
    //textureCanvasCtx.scale(-1, 1);
    //textureCanvasCtx.translate(textureCanvas.width, 0);
    //textureCanvasCtx.scale(-1, 1);
    textureCanvasCtx.drawImage(
        video,
        minX, minY, cropWidth, cropHeight,
        0, 0, textureCanvas.width, textureCanvas.height
    );
    textureCanvasCtx.restore();
}

// Assuming init() is called via window.onload from index.html now.
// Do NOT call init() directly here anymore.
init();
