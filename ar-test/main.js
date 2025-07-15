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
let exportedMeshData = null;

// WebXR specific variables
let arHitTestSource = null;
let arRefSpace = null;
let placedObject = null; // To hold the loaded GLTF model in AR
let reticle = null; // A visual indicator for hit-testing

let DOMVIDEO = null;


const NUM_LANDMARKS = UV_COORDS.length;

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;


// === Removed DOMContentLoaded listener, rely on window.onload from index.html ===
// No direct init() call here in main.js
// ==============================================================================
window.init = init;

async function init() {
    log("init() started.");

    // 1. Setup Three.js Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x333333);
    console.log("Scene created.");

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;
    console.log("Camera created. Position Z:", camera.position.z);
    
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

function log(text) {
    var div = document.getElementById('error');

    div.innerHTML += text;
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
// --- Main Animation Loop ---
// This function needs to ensure the render loop runs whether in AR or not.
function animate() { // This is the function called by init()
    requestAnimationFrame(animate); // Keep this for the non-AR loop

    // The 'render' function is now solely for the content within the loop.
    // It is called by requestAnimationFrame when not in XR, and by renderer.setAnimationLoop when in XR.
    render(); // Call your main rendering logic (which handles both modes)
}

// --- WebXR Render Loop (renamed for clarity, handles both modes) ---
function render(time, frame) { // 'time' and 'frame' are provided by setAnimationLoop in XR, but will be undefined for requestAnimationFrame
    // If we're in an XR session (AR mode)
    // Check if we're in an XR session (AR mode)
    if (renderer.xr.isPresenting) {

        

        
        log("AR Mode: Presenting."); // Confirm AR session is active

        // Hide front-camera elements
        video.style.display = 'none';
        faceMesh.visible = false;
        if (normalsHelper) normalsHelper.visible = false;
        if (meshBoxHelper) meshBoxHelper.visible = false;



        WebARRocksMediaStreamAPIHelper.get(DOMVIDEO, initWebARRocks, function(){
          log('Cannot get video bro :(');
        }, {
          video: true, //mediaConstraints
          audio: false
        })


        
        const session = renderer.xr.getSession(); // Get the current XR session

        // 1. Request Reference Space and Hit Test Source
        if (arHitTestSource === null) {
            console.log("AR Mode: Requesting viewer reference space...");
            session.requestReferenceSpace('viewer').then((refSpace) => {
                arRefSpace = refSpace;
                console.log("AR Mode: Viewer reference space obtained. Requesting hit test source...");
                session.requestHitTestSource({ space: arRefSpace }).then((source) => {
                    arHitTestSource = source;
                    console.log("AR Mode: Hit test source obtained:", arHitTestSource);
                }).catch(e => console.error("AR Mode: Error requesting hit test source:", e)); // IMPORTANT CATCH
            }).catch(e => console.error("AR Mode: Error requesting reference space:", e)); // IMPORTANT CATCH
        }

        // 2. Perform Hit Test
        if (arHitTestSource) {
            const hitTestResults = frame.getHitTestResults(arHitTestSource);
            console.log("AR Mode: Hit test results count:", hitTestResults.length); // CRITICAL LOG

            if (hitTestResults.length > 0) {
                console.log("AR Mode: Surface detected! Attempting to show reticle.");
                const hit = hitTestResults[0];
                const pose = hit.getPose(arRefSpace);

                // --- Show Reticle ---
                if (!reticle) {
                    console.log("AR Mode: Creating reticle mesh."); // Confirm reticle creation
                    reticle = new THREE.Mesh(
                        new THREE.RingGeometry(0.1, 0.12, 32).rotateX(-Math.PI / 2),
                        new THREE.MeshBasicMaterial({ color: 0xffffff })
                    );
                    reticle.matrixAutoUpdate = false;
                    scene.add(reticle);
                }
                reticle.matrix.fromArray(pose.transform.matrix);
                reticle.visible = true;
                // --- End Reticle ---

                // ... (your existing click handler for placement) ...
                if (!renderer.domElement.onclick) { // Attach click listener only once
                    renderer.domElement.onclick = () => {
                        if (exportedMeshData && reticle.visible && !placedObject) {
                            console.log("AR Mode: Screen tapped, attempting to place object."); // Confirm tap
                            const loader = new GLTFLoader();
                            const gltfJsonString = JSON.stringify(exportedMeshData);
                            loader.parse(gltfJsonString, function(gltf) {
                                placedObject = gltf.scene;
                                placedObject.position.setFromMatrixPosition(reticle.matrix);
                                placedObject.scale.set(0.1, 0.1, 0.1); // Adjust this scale!
                                scene.add(placedObject);
                                reticle.visible = false;
                                arHitTestSource.cancel();
                                arHitTestSource = null;
                                renderer.domElement.onclick = null;
                                console.log("AR Mode: Object placed successfully."); // Confirm placement
                            }, undefined, function(error) { console.error("AR Mode: Error loading GLTF from memory:", error); });
                        }
                    };
                }

            } else {
                console.log("AR Mode: No surface detected in this frame."); // Informative log
                if (reticle) reticle.visible = false;
            }
        } else {
             console.log("AR Mode: arHitTestSource not yet obtained or invalid."); // For initial frames
        }
    } else {
        // --- NON-AR MODE (Front Camera & Face Tracking) LOGIC ---
        // This is the code that handles your front camera MediaPipe detection
        // and mesh updates.
        video.style.display = 'block'; // Show the video element
        // The face mesh visibility will be controlled by the MediaPipe results check
        // if (faceMesh) faceMesh.visible = true; // No, let the MediaPipe detection control its visibility

        // Ensure lastVideoTime is managed correctly within this scope if not global
        let currentVideoTime = video.currentTime; // Get current time here

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            if (currentVideoTime !== (lastVideoTime || -1)) { // Use a property of 'this' or a local variable
                lastVideoTime = currentVideoTime; // Store last video time

                const results = faceLandmarker.detectForVideo(video, performance.now());

                if (results && results.faceLandmarks && results.faceLandmarks.length > 0 &&
                    results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0 &&
                    results.facialTransformationMatrixes[0] && results.facialTransformationMatrixes[0].data &&
                    results.facialTransformationMatrixes[0].data.length === 16) {

                    // FACE DETECTED!
                    faceMesh.visible = true; // Make face mesh visible
                    // if (normalsHelper) normalsHelper.visible = true;
                    // if (meshBoxHelper) meshBoxHelper.visible = true;

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

                    const scaleFactor = 50;
                    const threeMatrix = new THREE.Matrix4().fromArray(transformMatrix);
                    threeMatrix.multiply(new THREE.Matrix4().makeScale(1, -1, 1)); // Flip Y-axis (for upside down)
                    threeMatrix.multiply(new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor));
                    faceMesh.matrix.copy(threeMatrix);
                    faceMesh.matrixAutoUpdate = false;
                    faceMesh.matrixWorldNeedsUpdate = true;

                    // --- Live Debugging Logs ---
                    const worldPosition = new THREE.Vector3();
                    faceMesh.updateWorldMatrix(true, false); // Ensure world matrix is updated
                    worldPosition.setFromMatrixPosition(faceMesh.matrixWorld);
                    console.log("Face Mesh World Position (XYZ):", worldPosition.x, worldPosition.y, worldPosition.z);
                    
                    if (faceMesh.geometry.boundingBox) {
                        faceMesh.geometry.boundingBox.applyMatrix4(faceMesh.matrixWorld);
                        const size = faceMesh.geometry.boundingBox.getSize(new THREE.Vector3());
                        console.log("Face Mesh World Size (XYZ):", size.x, size.y, size.z);
                        console.log("Face Mesh World Bounding Box Min/Max:", faceMesh.geometry.boundingBox.min, faceMesh.geometry.boundingBox.max);
                    }
                    // ---------------------------
                    
                    drawFaceTexture(faceLandmarks, video.videoWidth, video.videoHeight);
                    faceTexture.needsUpdate = true;

                } else {
                    // No face detected in non-AR mode
                    faceMesh.visible = false; // Hide face mesh
                    // if (normalsHelper) normalsHelper.visible = false;
                    // if (meshBoxHelper) meshBoxHelper.visible = false;
                }
            }
        }
    }
    renderer.render(scene, camera); // This must be called at the end of the loop
}

function initWebARRocks(){
  WEBARROCKSOBJECT.init({
    canvasId: 'outputCanvas',
    video: DOMVIDEO,
    callbackReady: function(errLabel){
      if (errLabel){
        log('An error happens bro: ',errLabel);
      } else {
        load_neuralNet();
      }
    }
  });
}

function load_neuralNet(){
  WEBARROCKSOBJECT.set_NN('./neuralNets/NN_OBJ4_0.json', function(errLabel){
    if (errLabel){
      log('ERROR: cannot load the neural net', errLabel);
    } else {
      start();
    }
  });
}

function start(){
  log('INFO in demo.js: start()');

  // scale the canvas with CSS to have the same aspectRatio than the video:
  let sx = 1, sy = 1;
  const aspectRatioVideo = DOMVIDEO.videoWidth / DOMVIDEO.videoHeight;
  if (aspectRatioVideo>1){ // landscape
    sy = 1 / aspectRatioVideo;
  } else { // portrait
    sx = aspectRatioVideo;
  }
  const domCanvas = document.getElementById('outputCanvas');
  domCanvas.style.transformOrigin = '50% 0%';
  domCanvas.style.transform = 'scale('+sx.toFixed(2)+','+sy.toFixed(2)+') translate(-50%, -50%) rotateY(180deg)';

  // start drawing and detection loop:
  iterate();
}

function iterate(){ // detect loop
  const detectState = WEBARROCKSOBJECT.detect(3);
  if (detectState.label){
    log('INFO in demo.js: ', detectState.label, 'IS CONFIRMED YEAH!!!');
  }
  window.requestAnimationFrame(iterate);
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
