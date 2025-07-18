// main.js - Final version with local scripts and fullscreen resizing.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FACEMESH_TESSELATION } from './face_mesh_data.js';

// --- Global variables ---
let scene, camera, renderer, video, faceLandmarker;
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let exportedMeshData = null;
const runningMode = "VIDEO";
let animationFrameId;
let currentMode = null;
let onRenderFcts = []; // An array of functions for the render loop

// --- AR specific variables ---
let arToolkitSource, arToolkitContext, multiMarkerControls;
let savedProfileData = null; 

function loadLegacyScript(url) {
    return new Promise((resolve, reject) => {
        window.THREE = THREE;
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
        document.head.appendChild(script);
    });
}

// 💡 NEW: A robust resize handler for all modes
function onResize() {
    if (arToolkitSource) {
        arToolkitSource.onResizeElement();
        arToolkitSource.copyElementSizeTo(renderer.domElement);
        if (arToolkitContext && arToolkitContext.arController !== null) {
            arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
        }
    }

    if (renderer) {
        const canvas = renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    }
}


async function main() {
    try {
        // Load the local AR.js libraries. This is the most reliable way.
        await Promise.all([
            loadLegacyScript('https://raw.githack.com/AR-js-org/AR.js/master/three.js/build/ar-threex.js')
            //loadLegacyScript('./vendor/threex-armultimarker.js')
        ]);
        console.log("✅ Local AR.js libraries loaded successfully.");
        
        THREEx.ArToolkitContext.baseURL = './';

        // 💡 Add the resize event listener globally
        window.addEventListener('resize', onResize, false);
        
        initMediaPipe();

    } catch (error) {
        console.error("❌ Error loading AR.js scripts:", error);
    }
}

// =================================================================================
// MEDIAPIPE PHASE (Largely unchanged)
// =================================================================================

async function initMediaPipe() {
    currentMode = 'mediapipe';
    onRenderFcts = [];
    
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2.5;

    const canvas = document.getElementById('outputCanvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    canvas.style.display = 'block';

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(0, 1, 1);
    scene.add(dirLight);

    video = document.getElementById('webcamVideo');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    await new Promise(resolve => { video.onloadedmetadata = () => { video.play(); resolve(); }; });
    video.style.display = 'none';

    const visionResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(visionResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
        runningMode, numFaces: 1 });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(478 * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(478 * 2), 2));
    geometry.setIndex(FACEMESH_TESSELATION.flat());
    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 512; textureCanvas.height = 512;
    textureCanvasCtx = textureCanvas.getContext('2d');
    faceTexture = new THREE.CanvasTexture(textureCanvas);
    const material = new THREE.MeshStandardMaterial({ map: faceTexture, side: THREE.DoubleSide });
    faceMesh = new THREE.Mesh(geometry, material);
    scene.add(faceMesh);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'flex';
    document.getElementById('phase1').style.display = 'block';
    document.getElementById('saveButton').addEventListener('click', saveMesh);
    document.getElementById('learnerButton').addEventListener('click', initLearner);

    onRenderFcts.push(renderMediaPipe);
    animate();
}

function saveMesh() {
    if (currentMode !== 'mediapipe' || !faceLandmarker) return;
    const results = faceLandmarker.detectForVideo(video, performance.now());
    if (results.faceLandmarks.length === 0) { alert("No face detected. Please look at the camera."); return; }
    const exporter = new GLTFExporter();
    exporter.parse(faceMesh, (gltf) => {
        exportedMeshData = gltf;
        alert("Face mesh saved! Now, start the learner.");
        document.getElementById('phase1').style.display = 'none';
        document.getElementById('phase2').style.display = 'block';
    }, (error) => console.error(error), { binary: true });
}


// =================================================================================
// LEARNER PHASE (Updated with resize logic)
// =================================================================================

function initLearner() {
    cleanup();
    currentMode = 'learner';
    onRenderFcts = [];

    const canvas = document.getElementById('outputCanvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(new THREE.Color('lightgrey'), 0);
    renderer.setSize(window.innerWidth, window.innerHeight);
    canvas.style.display = 'block';

    scene = new THREE.Scene();
    camera = new THREE.Camera();
    scene.add(camera);

    arToolkitSource = new THREEx.ArToolkitSource({ sourceType: 'webcam' });
    arToolkitSource.init(() => {
        // 💡 Call onResize here to set the initial size correctly.
        onResize();
    });

    arToolkitContext = new THREEx.ArToolkitContext({
        cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
        detectionMode: 'mono',
    });
    arToolkitContext.init(() => camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix()));
    
    onRenderFcts.push(() => {
        if (!arToolkitSource || !arToolkitSource.ready) return;
        arToolkitContext.update(arToolkitSource.domElement);
    });

    const subMarkersControls = [];
    const markerNames = ['hiro', 'kanji', 'letterA'];
    markerNames.forEach(markerName => {
        const markerRoot = new THREE.Group();
        scene.add(markerRoot);
        const markerControls = new THREEx.ArMarkerControls(arToolkitContext, markerRoot, {
            type: 'pattern',
            patternUrl: `./patt/patt.${markerName}`,
        });
        subMarkersControls.push(markerControls);
    });

    multiMarkerLearning = new THREEx.ArMultiMakersLearning(arToolkitContext, subMarkersControls);
    multiMarkerLearning.enabled = true;

    // --- UI (Same as before) ---
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'dynamicUI';
    controlsContainer.style.cssText = 'position: absolute; top: 10px; left: 10px; z-index: 10; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 5px; color: white;';
    controlsContainer.innerHTML = `
        <button id="resetBtn">Reset Learning</button>
        <button id="saveAndPlayBtn">Save Profile & Start Player</button>
        <div style="margin-top: 10px;">Status: <span id="learningStatus" style="font-weight: bold; color: red;">In Progress...</span></div>
    `;
    document.body.appendChild(controlsContainer);
    document.getElementById('resetBtn').onclick = () => multiMarkerLearning.resetStats();
    document.getElementById('saveAndPlayBtn').onclick = () => {
        const profileData = JSON.parse(multiMarkerLearning.toJSON());
        if (!profileData || !profileData.subMarkersControls || profileData.subMarkersControls.length < markerNames.length) {
            alert(`Learning not complete! Please show all markers.`);
            return;
        }
        profileData.parameters = { type: 'area' };
        savedProfileData = profileData;
        alert("Profile saved. Starting player...");
        initCombinedPlayer(savedProfileData);
    };

    onRenderFcts.push(animateARLearner);
    animate();
}

// =================================================================================
// PLAYER PHASE (Updated with resize logic)
// =================================================================================

async function initCombinedPlayer(profileData) {
    cleanup();
    currentMode = 'player';
    onRenderFcts = [];
    document.getElementById('uiContainer').style.display = 'none';

    const canvas = document.getElementById('outputCanvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(new THREE.Color('lightgrey'), 0);
    renderer.setSize(window.innerWidth, window.innerHeight);
    canvas.style.display = 'block';

    scene = new THREE.Scene();
    camera = new THREE.Camera();
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    scene.add(new THREE.DirectionalLight(0xffffff, 0.7));

    arToolkitSource = new THREEx.ArToolkitSource({ sourceType: 'webcam' });
    arToolkitSource.init(() => {
        // 💡 Call onResize here as well.
        onResize();

        arToolkitContext = new THREEx.ArToolkitContext({
            cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
            detectionMode: 'mono'
        });
        arToolkitContext.init(() => {
            camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());
        });

        const markerRoot = new THREE.Group();
        scene.add(markerRoot);
        multiMarkerControls = THREEx.ArMultiMarkerControls.fromJSON(arToolkitContext, scene, markerRoot, JSON.stringify(profileData));

        const arjsObject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 'red' }));
        arjsObject.position.y = 0.5;
        markerRoot.add(arjsObject);
        
        onRenderFcts.push(animateCombinedPlayer);
    });
    
    animate();
}

// =================================================================================
// GENERAL ANIMATION & UTILITY FUNCTIONS
// =================================================================================

function cleanup() {
    cancelAnimationFrame(animationFrameId);
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
    if (renderer) {
        renderer.dispose();
        renderer = null;
    }
    const dynamicUI = document.getElementById('dynamicUI');
    if (dynamicUI) dynamicUI.remove();
}

function animate() {
    animationFrameId = requestAnimationFrame(animate);
    onRenderFcts.forEach(fct => fct());
    if(renderer) renderer.render(scene, camera);
}

function animateARLearner() {
    if (multiMarkerLearning) {
        multiMarkerLearning.computeResult();
        const statusElement = document.getElementById('learningStatus');
        if (statusElement) {
            let nMarkersLearned = 0;
            multiMarkerLearning.subMarkersControls.forEach(function(markerControls) {
                if (markerControls.object3d.userData.result?.confidenceFactor >= 1) {
                    nMarkersLearned++;
                }
            });
            if (nMarkersLearned === multiMarkerLearning.subMarkersControls.length) {
                statusElement.innerHTML = 'Ready to Start Player!';
                statusElement.style.color = 'lightgreen';
            } else {
                statusElement.innerHTML = `In Progress... (${nMarkersLearned}/${multiMarkerLearning.subMarkersControls.length})`;
                statusElement.style.color = 'red';
            }
        }
    }
}

function animateCombinedPlayer() {
    if (arToolkitSource && arToolkitSource.ready) {
        arToolkitContext.update(arToolkitSource.domElement);
        if (multiMarkerControls) {
            multiMarkerControls.update();
        }
    }
}

let lastVideoTime = -1;
function renderMediaPipe() {
    if (video && faceLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const results = faceLandmarker.detectForVideo(video, performance.now());
        if (results.faceLandmarks.length > 0) {
            faceMesh.visible = true;
            const landmarks = results.faceLandmarks[0];
            const positions = faceMesh.geometry.attributes.position.array;
            const uvs = faceMesh.geometry.attributes.uv.array;
            for (let i = 0; i < landmarks.length; i++) {
                positions[i * 3] = (landmarks[i].x - 0.5) * 2;
                positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
                positions[i * 3 + 2] = -landmarks[i].z;
                uvs[i * 2] = landmarks[i].x;
                uvs[i * 2 + 1] = 1.0 - landmarks[i].y;
            }
            faceMesh.geometry.attributes.position.needsUpdate = true;
            faceMesh.geometry.attributes.uv.needsUpdate = true;
            faceMesh.geometry.computeVertexNormals();
            textureCanvasCtx.clearRect(0, 0, 512, 512);
            textureCanvasCtx.drawImage(video, 0, 0, 512, 512);
            faceTexture.needsUpdate = true;
        } else {
            faceMesh.visible = false;
        }
    }
}

// --- Start the Application ---
main();