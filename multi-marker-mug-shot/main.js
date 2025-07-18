// main.js - Modified to save marker profiles in memory instead of file download/upload.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FACEMESH_TESSELATION } from './face_mesh_data.js';
import { WebARRocksObjectThreeHelper } from './helpers/WebARRocksObjectThreeHelper.js';


// Global variables
let scene, camera, renderer, video, faceLandmarker;
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let exportedMeshData = null;
const runningMode = "VIDEO";
let animationFrameId;
let currentMode = null;
let webARrocksGroupAdded = false;

// AR specific variables
let arToolkitSource, arToolkitContext, multiMarkerControls, multiMarkerLearning;
let savedProfileData = null; // 💡 To store the marker profile in memory
const _settings = { NNPath: './neuralNets/NN_COFFEE_0.json' };

function loadLegacyScript(url) {
    return new Promise((resolve, reject) => {
        window.THREE = THREE;
        if (!window.THREE.EventDispatcher) { window.THREE.EventDispatcher = THREE.ObjectD; }
        if (!window.THREE.Matrix4.prototype.getInverse) {
            window.THREE.Matrix4.prototype.getInverse = function(matrix) { return this.copy(matrix).invert(); };
        }
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function main() {
    try {
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-artoolkitsource.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-artoolkitprofile.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-artoolkitcontext.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-arsmoothedcontrols.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-armarkerhelper.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-armarkercontrols.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-armarkercloak.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-arbasecontrols.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-arclickability.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-arvideoinwebgl.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-armultimarkercontrols.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-armultimarkerslearning.js');
        loadLegacyScript('https://raw.githubusercontent.com/jeromeetienne/AR.js/refs/heads/master/three.js/src/threex/threex-arprofile.js');
        //Fix for THREEx.ArMultiMarkerControls
        // 2. NOW, apply the monkey patch to the loaded THREEx object
        THREEx.ArMultiMarkerControls.prototype.update = function() {
        // Get the markerRoot and context from 'this' instead of an argument
            var markerRoot = this.object3d;
            var arToolkitContext = this.arToolkitContext; 
            var subMarkerControls = this.parameters.subMarkersControls;

            // Update all sub-markers
            subMarkerControls.forEach(function(markerControls) {
                // Call the sub-marker's update, which uses its own internal state
                markerControls.update(arToolkitContext);
            });

            // Get the visible sub-markers
            var visibleSubMarkers = subMarkerControls.filter(function(markerControls) {
                // 💡 Filter for markers that are visible AND have the required matrix data
                return markerControls.object3d.visible === true && markerControls.parameters.matrix;
            });

            // If no sub-marker is visible, hide the root and stop
            if (visibleSubMarkers.length === 0) {
                markerRoot.visible = false;
                return;
            }

            // If we have visible markers, make the root visible
            markerRoot.visible = true;

            // --- The rest of the matrix calculation logic remains the same ---
            var center = new THREE.Vector3();
            var matrices = [];

            for (var i = 0; i < visibleSubMarkers.length; i++) {
                var subMatrix = new THREE.Matrix4().getInverse(visibleSubMarkers[i].object3d.matrix);
                var learnedMatrix = new THREE.Matrix4();
                learnedMatrix.elements = visibleSubMarkers[i].parameters.matrix.elements;
                var resultMatrix = new THREE.Matrix4().multiplyMatrices(subMatrix, learnedMatrix);
                center.applyMatrix4(resultMatrix);
                var finalMatrix = new THREE.Matrix4().getInverse(resultMatrix);
                matrices.push(finalMatrix);
            }

            center.divideScalar(visibleSubMarkers.length);

            var averageMatrix = matrices[0].clone();
            for (var i = 1; i < matrices.length; i++) {
                averageMatrix.multiply(matrices[i]);
            }
            
            var position = new THREE.Vector3();
            var quaternion = new THREE.Quaternion();
            var scale = new THREE.Vector3();
            averageMatrix.decompose(position, quaternion, scale);

            markerRoot.position.copy(position);
            markerRoot.quaternion.copy(quaternion);
            markerRoot.scale.copy(scale);
            markerRoot.matrix.compose(markerRoot.position, markerRoot.quaternion, markerRoot.scale);
            markerRoot.matrixWorldNeedsUpdate = true;
        };

        THREEx.ArMultiMakersLearning.prototype.computeResult = function() {
            const subMarkersControls = this.subMarkersControls;
            const visibleSubMarkers = subMarkersControls.filter(controls => controls.object3d.visible);

            // If we can't see any markers, do nothing.
            if (visibleSubMarkers.length === 0) {
                return;
            }

            // Find if an anchor marker has already been established.
            let anchorMarker = subMarkersControls.find(controls => controls.parameters.matrix !== undefined);

            // If no anchor exists yet, make the first visible marker the anchor.
            // Its matrix is the Identity matrix (no transformation relative to itself).
            if (!anchorMarker && visibleSubMarkers.length > 0) {
                anchorMarker = visibleSubMarkers[0];
                anchorMarker.parameters.matrix = new THREE.Matrix4();
            }
            
            // If we still couldn't establish an anchor, exit.
            if (!anchorMarker) {
                return;
            }

            // Get the anchor's current transformation matrix in world space.
            const anchorMatrix = anchorMarker.object3d.matrix.clone();

            // For any other visible marker that hasn't been learned yet...
            visibleSubMarkers.forEach(function(markerControls) {
                if (markerControls === anchorMarker || markerControls.parameters.matrix !== undefined) {
                    return; //...skip it if it's the anchor or is already learned.
                }

                // Get this marker's transformation matrix.
                var markerMatrix = markerControls.object3d.matrix.clone();
                
                // Calculate the matrix that transforms from the anchor's space to this marker's space,
                // and store it. This is the "learned" relative position.
                markerControls.parameters.matrix = new THREE.Matrix4().multiplyMatrices(markerMatrix.clone().invert(), anchorMatrix);
            });
        };
        console.log("AR.js update function patched.");
        
        initMediaPipe();
    } catch (error) {
        console.error("Error loading ar-threex.js:", error);
    }
}

async function initMediaPipe() {
    currentMode = 'mediapipe';
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
    await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });
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

    // 💡 REMOVED playerButton and profileInput logic, as player is now started from the learner.
    
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

function cleanup() {
    cancelAnimationFrame(animationFrameId);
    if (video && video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); video.srcObject = null; }
    if (renderer) {
        renderer.dispose();
        renderer = null;
    }
    if (currentMode === 'player') { 
        WebARRocksObjectThreeHelper.destroy();
        webARrocksGroupAdded = false;
    }
    const dynamicUI = document.getElementById('dynamicUI');
    if(dynamicUI) dynamicUI.remove();
}

function initLearner() {
    cleanup();
    currentMode = 'learner';
    const canvas = document.getElementById('outputCanvas');
    canvas.style.display = 'block';
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    scene = new THREE.Scene();
    camera = new THREE.Camera();
    scene.add(camera);
    arToolkitSource = new THREEx.ArToolkitSource({ sourceType: 'webcam' });
    arToolkitSource.init(() => {
        setTimeout(() => {
            arToolkitSource.onResizeElement();
            arToolkitSource.copyElementSizeTo(renderer.domElement);
        }, 100);
    });
    arToolkitContext = new THREEx.ArToolkitContext({
        cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
        detectionMode: 'mono',
    });
    arToolkitContext.init(() => camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix()));
    const subMarkersControls = [];
    const markerNames = ['hiro', 'kanji', 'letterA'];

    markerNames.forEach(function(markerName){
        const markerRoot = new THREE.Group();
        scene.add(markerRoot);
        const markerControls = new THREEx.ArMarkerControls(arToolkitContext, markerRoot, {
            type: 'pattern',
            patternUrl: `./patt/patt.${markerName}`,
        });
        const markerHelper = new THREEx.ArMarkerHelper(markerControls);
        markerControls.object3d.add(markerHelper.object3d);
        subMarkersControls.push(markerControls);
    });
    multiMarkerLearning = new THREEx.ArMultiMakersLearning(arToolkitContext, subMarkersControls);
    multiMarkerLearning.enabled = true;

    // --- MODIFIED UI FOR LEARNING STATUS ---
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'dynamicUI';
    controlsContainer.style.cssText = 'position: absolute; top: 10px; left: 10px; z-index: 10; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 5px; color: white;';
    // 💡 Changed button to "Save Profile & Start Player"
    controlsContainer.innerHTML = `
        <button id="resetBtn">Reset Learning</button>
        <button id="saveAndPlayBtn">Save Profile & Start Player</button>
        <div style="margin-top: 10px;">Status: <span id="learningStatus" style="font-weight: bold; color: red;">In Progress...</span></div>
        <div id="markerStatusContainer" style="margin-top: 10px; background: rgba(0,0,0,0.3); padding: 5px; border-radius: 3px; font-family: monospace;"></div>
    `;
    document.body.appendChild(controlsContainer);
    document.getElementById('resetBtn').onclick = () => multiMarkerLearning.resetStats();
    
    // --- MODIFIED BUTTON LOGIC TO SAVE TO MEMORY AND START PLAYER ---
    document.getElementById('saveAndPlayBtn').onclick = () => {
        // First, ensure the learning results are fully computed
        multiMarkerLearning.computeResult();

        // 💡 Stricter Check: Verify that EVERY sub-marker has a learned matrix.
        const isLearningComplete = multiMarkerLearning.subMarkersControls.every(function(controls) {
            return controls.parameters.matrix !== undefined;
        });

        if (!isLearningComplete) {
            alert("Learning is not complete! Please show all markers to the camera at the same time until the model is stable.");
            return;
        }
        
        const profileData = JSON.parse(multiMarkerLearning.toJSON());
        
        profileData.parameters = {
            type: 'area'
        };
        
        savedProfileData = profileData;
        alert("Profile saved to memory. Starting the player...");
        initCombinedPlayer(savedProfileData);
    };
    
    animateAR();
}

// Make sure this is in the global scope so animateCombined can see it

async function initCombinedPlayer(profileData) {
    cleanup();
    currentMode = 'player';
    document.getElementById('uiContainer').style.display = 'none';

    const canvas = document.getElementById('outputCanvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    scene = new THREE.Scene();
    camera = new THREE.Camera();
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));

    arToolkitSource = new THREEx.ArToolkitSource({ sourceType: 'webcam' });

    arToolkitSource.init(() => {
        arToolkitSource.onResizeElement();
        arToolkitSource.copyElementSizeTo(renderer.domElement);

        arToolkitContext = new THREEx.ArToolkitContext({
            cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
            detectionMode: 'mono'
        });

        arToolkitContext.init(() => {
            camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());
            
            const markerRoot = new THREE.Group();
            scene.add(markerRoot);

            // 💡 Now that the library is fixed, we can use fromJSON again.
            multiMarkerControls = THREEx.ArMultiMarkerControls.fromJSON(arToolkitContext, scene, markerRoot, JSON.stringify(profileData));
            
            const arjsObject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 'red' }));
            arjsObject.position.y = 0.5;
            markerRoot.add(arjsObject);

            animateCombined();
        });
    });
}

// Ensure your animation loop uses multiMarkerControls
function animateCombined() {
    if (currentMode !== 'player') return;
    animationFrameId = requestAnimationFrame(animateCombined);
    
    if (arToolkitSource && arToolkitSource.ready) { 
        arToolkitContext.update(arToolkitSource.domElement); 
        if (multiMarkerControls) {
            multiMarkerControls.update();
        }
    }
    renderer.render(scene, camera);
}

function animate() {
    if (currentMode !== 'mediapipe') return;
    animationFrameId = requestAnimationFrame(animate);
    renderMediaPipe();
}

function animateAR() {
    if (currentMode !== 'learner') return;

    animationFrameId = requestAnimationFrame(animateAR);

    if (!arToolkitSource || !arToolkitSource.ready) {
        return;
    }

    arToolkitContext.update(arToolkitSource.domElement);

    if (multiMarkerLearning) {
        // 💡 FIX: Update each sub-marker's status on every frame.
        // This was the missing step. It updates the .visible property for each marker.
        multiMarkerLearning.subMarkersControls.forEach(function(markerControls) {
            markerControls.update(arToolkitContext);
        });

        // Now that visibilities are updated, compute the learning result.
        multiMarkerLearning.computeResult();


        // --- UI update logic (this part remains the same) ---
        const statusElement = document.getElementById('learningStatus');
        const markerStatusContainer = document.getElementById('markerStatusContainer');
        
        if (statusElement && markerStatusContainer) {
            let nMarkersLearned = 0;
            let markerStatusHTML = '<ul style="list-style: none; padding: 0; margin: 0;">';

            multiMarkerLearning.subMarkersControls.forEach(function(markerControls) {
                const patternName = markerControls.parameters.patternUrl.split('.').pop();
                
                if (markerControls.parameters.matrix !== undefined) {
                    nMarkersLearned++;
                    markerStatusHTML += `<li style="color: lightgreen;">- ${patternName}: Learned ✔️</li>`;
                } else {
                    markerStatusHTML += `<li style="color: #FF8A8A;">- ${patternName}: Waiting... ❌</li>`;
                }
            });

            markerStatusHTML += '</ul>';
            markerStatusContainer.innerHTML = markerStatusHTML;

            if (nMarkersLearned === multiMarkerLearning.subMarkersControls.length) {
                statusElement.innerHTML = 'Ready to Save Profile!';
                statusElement.style.color = 'lightgreen';
            } else {
                statusElement.innerHTML = `In Progress... (${nMarkersLearned}/${multiMarkerLearning.subMarkersControls.length})`;
                statusElement.style.color = 'red';
            }
        }
    }

    renderer.render(scene, camera);
}

let lastVideoTime = -1;
function renderMediaPipe() {
    if (video && faceLandmarker && video.readyState === video.HAVE_ENOUGH_DATA && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const results = faceLandmarker.detectForVideo(video, performance.now());
        if (results.faceLandmarks.length > 0) {
            faceMesh.visible = true;
            const landmarks = results.faceLandmarks[0];
            const positions = faceMesh.geometry.attributes.position.array;
            const uvs = faceMesh.geometry.attributes.uv.array;
            for (let i = 0; i < landmarks.length; i++) {
                positions[i * 3]     = (landmarks[i].x - 0.5) * 2;
                positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
                positions[i * 3 + 2] = -landmarks[i].z;
                uvs[i * 2]           = landmarks[i].x;
                uvs[i * 2 + 1]       = 1.0 - landmarks[i].y;
            }
            faceMesh.geometry.attributes.position.needsUpdate = true;
            faceMesh.geometry.attributes.uv.needsUpdate = true;
            faceMesh.geometry.computeVertexNormals();
            textureCanvasCtx.clearRect(0, 0, 512, 512);
            textureCanvasCtx.drawImage(video, 0, 0, 512, 512);
            faceTexture.needsUpdate = true;
        } else { faceMesh.visible = false; }
    }
    if (renderer) renderer.render(scene, camera);
}

main();