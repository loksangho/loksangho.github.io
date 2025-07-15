import * as THREE from 'three';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

import { FACEMESH_TESSELATION, UV_COORDS } from './face_mesh_data.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js'; // Add this at the top of main.js
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; // NEW: For loading GLTF from memory
import { ARButton } from 'three/addons/webxr/ARButton.js'; // NEW: For WebXR AR sessions

let scene, camera, renderer;
let video, faceLandmarker, runningMode = "VIDEO";
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let debugCube;
let meshBoxHelper;
var saveButton=null;
let exportedMeshData = null;

// WebXR specific variables
let arHitTestSource = null;
let arRefSpace = null;
let placedObject = null; // To hold the loaded GLTF model in AR
let reticle = null; // A visual indicator for hit-testing

const NUM_LANDMARKS = UV_COORDS.length;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;


// === Removed DOMContentLoaded listener, rely on window.onload from index.html ===
// No direct init() call here in main.js
// ==============================================================================
window.init = init;

async function init() {
    console.log("init() started.");

    // 1. Setup Three.js Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);
    console.log("Scene created.");

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;
    console.log("Camera created. Position Z:", camera.position.z);

    saveButton = document.getElementById('saveButton');
    if (saveButton) {
        saveButton.style.display = 'block'; // Show the button once app is loaded
        saveButton.addEventListener('click', saveMesh); // Attach click listener
    }
    
    const outputCanvasElement = document.getElementById('outputCanvas'); // Should be found by now
    if (!outputCanvasElement) {
        console.error("ERROR: 'outputCanvas' element not found in HTML! Renderer cannot be created.");
        document.getElementById('loading').innerText = "Error: Canvas not found.";
        return;
    }
    console.log("Canvas element found for renderer:", outputCanvasElement); // New diagnostic log

    try {
        // Attempt to create the WebGLRenderer
        renderer = new THREE.WebGLRenderer({
            canvas: outputCanvasElement,
            antialias: true,
            alpha: true, // Crucial for transparent background if needed
            // powerPreference: "high-performance" // Optional: hint for dedicated GPU on some systems
        });
        console.log("WebGLRenderer created successfully."); // New diagnostic log

        // If assignment failed *without* throwing, renderer would still be undefined
        if (!renderer) {
            console.error("ERROR: Renderer variable is still undefined after successful WebGLRenderer constructor. This is highly unexpected.");
            document.getElementById('loading').innerText = "Error: Renderer assignment failed.";
            return;
        }

    } catch (e) {
        // Catch any errors during WebGLRenderer creation
        console.error("ERROR: Failed to create WebGLRenderer!", e);
        console.error("Possible reasons: WebGL not supported, context lost, out of memory, or driver issues.");
        document.getElementById('loading').innerText = "Error: WebGL not available or failed to initialize. See console for details.";
        return;
    }

    // Now, after successful creation, proceed with setup
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement); // This is where the canvas is put in the DOM (already exists via HTML)


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
    geometry.center(); // Center the geometry's vertices around its own local origin (0,0,0)

    
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
        side: THREE.DoubleSide
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
    
     // *** ADD THE RESIZE LISTENER HERE ***
    window.addEventListener('resize', () => {
        if (camera && renderer) { // Add a check to be extra safe, though it should be defined here
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            console.log("Window resized. Renderer and camera updated.");
        }
    });

    document.getElementById('loading').style.display = 'none';
    // --- SAVE MESH BUTTON ---
    const saveButton = document.getElementById('saveButton');
    if (saveButton) {
        saveButton.style.display = 'block';
        saveButton.addEventListener('click', saveMesh);
    }

    // --- AR BUTTON SETUP ---
    // 1. Hide the video element and the initial canvas setup
    video.style.display = 'none';
    outputCanvasElement.style.zIndex = 2; // Ensure Three.js canvas is on top

    // 2. Set up WebXR for AR
    renderer.xr.enabled = true;
    const arButtonContainer = document.getElementById('arButton');
    // The ARButton handles checking for AR support and requesting a session
    document.body.appendChild(ARButton.createButton(renderer, {
        optionalFeatures: ['dom-overlay', 'dom-overlay-for-handheld-ar', 'hit-test'], // Request hit-test for placement
        domOverlay: { root: document.body } // Use the whole document body as AR overlay
    }));

    // Start the animation loop
    animate();
    console.log("init() finished, animation loop started.");
}

function saveMesh() {
    if (!faceMesh) {
        console.warn("No face mesh to save yet.");
        return;
    }

    const exporter = new GLTFExporter();

    // Options for exporter
    const options = {
        binary: false,      // Set to true if you want .glb (ArrayBuffer) instead of .gltf (JSON object)
        embedImages: true   // Embeds textures directly in the GLTF/GLB
    };

    exporter.parse(
        faceMesh,
        function (gltfData) { // `gltfData` will be the GLTF JSON object (if binary: false) or ArrayBuffer (if binary: true)
            console.log("Mesh exported to GLTF in memory.");

            // Store the GLTF data in your global variable
            exportedMeshData = gltfData;

            // --- Optional: Console log the data to inspect it ---
            if (options.binary) {
                console.log("GLB data (ArrayBuffer):", exportedMeshData);
                // You could then convert this ArrayBuffer to a Blob if needed later,
                // or send it over a network.
                // const tempBlob = new Blob([exportedMeshData], { type: 'model/gltf-binary' });
            } else {
                console.log("GLTF data (JSON object):", exportedMeshData);
                // You could then stringify this JSON object if needed for storage
                // const jsonString = JSON.stringify(exportedMeshData, null, 2);
                // console.log("GLTF JSON string:", jsonString);
            }

            // At this point, the data is in `exportedMeshData` and not downloaded.
            // You can now use `exportedMeshData` for other purposes, e.g.:
            // - Sending it via an API to a server
            // - Storing it in localStorage/sessionStorage (if small enough and you stringify JSON)
            // - Storing it in IndexedDB (for larger data, like ArrayBuffer)
            // - Loading it back into a Three.js scene later
        },
        function (error) {
            console.error('An error happened during GLTF export:', error);
        },
        options
    );
}

// *** Example of how you might retrieve and use it later (e.g., in another function) ***
function loadMeshFromMemory() {
    if (!exportedMeshData) {
        console.warn("No mesh data in memory to load.");
        return;
    }

    // You would use GLTFLoader to load this data back
    const loader = new THREE.GLTFLoader();

    if (options.binary) { // If you saved it as binary (.glb)
        loader.parse(exportedMeshData, function(gltf) {
            console.log("Loaded GLB from memory:", gltf.scene);
            // Example: Add it to the scene
            // scene.add(gltf.scene);
        });
    } else { // If you saved it as JSON (.gltf)
        const jsonString = JSON.stringify(exportedMeshData); // Stringify if you saved the object, then loader parses the string
        loader.parse(jsonString, function(gltf) {
            console.log("Loaded GLTF from memory:", gltf.scene);
            // Example: Add it to the scene
            // scene.add(gltf.scene);
        });
    }
}

// --- Main Animation Loop (Modified for WebXR) ---
let lastVideoTime = -1;
function animate() {
    renderer.setAnimationLoop(render); // WebXR animation loop replaces requestAnimationFrame
}

// --- WebXR Render Loop ---
function render(time, frame) {
    // If we're in an XR session (AR mode)
    if (renderer.xr.isPresenting) {
        // Hide the original webcam feed
        video.style.display = 'none';
        faceMesh.visible = false; // Hide the face mesh
        // If you had debug helpers, hide them too
        if (normalsHelper) normalsHelper.visible = false;
        if (meshBoxHelper) meshBoxHelper.visible = false;

        // Perform hit-testing to place objects
        if (frame && renderer.xr.getSession() && !placedObject) {
            const session = renderer.xr.getSession();
            if (arHitTestSource === null) {
                session.requestReferenceSpace('viewer').then((refSpace) => {
                    arRefSpace = refSpace;
                    session.requestHitTestSource({ space: arRefSpace }).then((source) => {
                        arHitTestSource = source;
                    });
                });
            }

            if (arHitTestSource) {
                const hitTestResults = frame.getHitTestResults(arHitTestSource);
                if (hitTestResults.length > 0) {
                    const hit = hitTestResults[0];
                    const pose = hit.getPose(arRefSpace);

                    // --- Show Reticle (Optional, but good UX) ---
                    if (!reticle) {
                        reticle = new THREE.Mesh(
                            new THREE.RingGeometry(0.1, 0.12, 32).rotateX(-Math.PI / 2),
                            new THREE.MeshBasicMaterial({ color: 0xffffff })
                        );
                        reticle.matrixAutoUpdate = false;
                        scene.add(reticle);
                    }
                    reticle.matrix.fromArray(pose.transform.matrix);
                    reticle.visible = true;

                    // --- Place Object on Tap (Example) ---
                    // Attach an event listener for user tap (only once)
                    if (!renderer.domElement.onclick) {
                        renderer.domElement.onclick = () => {
                            if (exportedMeshData && reticle.visible && !placedObject) {
                                // Load the GLTF from memory
                                const loader = new GLTFLoader();
                                const gltfJsonString = JSON.stringify(exportedMeshData); // Parse expects JSON string
                                loader.parse(gltfJsonString, function(gltf) {
                                    placedObject = gltf.scene; // Store the loaded scene

                                    // Position the loaded object at the reticle's location
                                    placedObject.position.setFromMatrixPosition(reticle.matrix);
                                    // Scale it down, as the saved face mesh might be large
                                    placedObject.scale.set(0.1, 0.1, 0.1); // ADJUST THIS SCALE!

                                    scene.add(placedObject);
                                    reticle.visible = false; // Hide reticle after placement
                                    arHitTestSource.cancel(); // Stop hit testing
                                    arHitTestSource = null;
                                    renderer.domElement.onclick = null; // Remove click listener
                                }, undefined, function(error) {
                                    console.error("Error loading GLTF from memory:", error);
                                });
                            }
                        };
                    }
                } else {
                    if (reticle) reticle.visible = false;
                }
            }
        }
    } else {
        // Not in an AR session (front camera mode)
        // MediaPipe Face Landmarker processing
        video.style.display = 'block'; // Show the video element
        faceMesh.visible = true; // Show the face mesh
        // And its helpers
        // if (normalsHelper) normalsHelper.visible = true;
        // if (meshBoxHelper) meshBoxHelper.visible = true;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            if (time !== lastVideoTime) { // Using 'time' from render callback for consistent updates
                lastVideoTime = time;
                const results = faceLandmarker.detectForVideo(video, performance.now());

                if (results && results.faceLandmarks && results.faceLandmarks.length > 0 &&
                    results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0 &&
                    results.facialTransformationMatrixes[0] && results.facialTransformationMatrixes[0].data &&
                    results.facialTransformationMatrixes[0].data.length === 16) {

                    // FACE DETECTED!
                    const faceLandmarks = results.faceLandmarks[0];
                    const transformMatrix = results.facialTransformationMatrixes[0].data;

                    const positions = faceMesh.geometry.attributes.position.array;
                    for (let i = 0; i < NUM_LANDMARKS; i++) {
                        const landmark = faceLandmarks[i];
                        positions[i * 3 + 0] = landmark.x;
                        positions[i * 3 + 1] = landmark.y;
                        positions[i * 3 + 2] = landmark.z;
                    }
                    faceMesh.geometry.attributes.position.needsUpdate = true;
                    faceMesh.geometry.computeVertexNormals();
                    faceMesh.geometry.computeBoundingBox();
                    faceMesh.geometry.computeBoundingSphere();
                    // if (normalsHelper) normalsHelper.update();
                    // if (meshBoxHelper) meshBoxHelper.update();

                    const scaleFactor = 300;
                    const threeMatrix = new THREE.Matrix4().fromArray(transformMatrix);
                    threeMatrix.multiply(new THREE.Matrix4().makeScale(1, -1, 1)); // Flip Y-axis (for upside down)
                    threeMatrix.multiply(new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor));
                    faceMesh.matrix.copy(threeMatrix);
                    faceMesh.matrixAutoUpdate = false;
                    faceMesh.matrixWorldNeedsUpdate = true;

                    drawFaceTexture(faceLandmarks, video.videoWidth, video.videoHeight);
                    faceTexture.needsUpdate = true;

                } else {
                    // No face detected, or data not available.
                    faceMesh.visible = false;
                    // if (normalsHelper) normalsHelper.visible = false;
                    // if (meshBoxHelper) meshBoxHelper.visible = false;
                }
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
