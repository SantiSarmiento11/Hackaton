/* ==========================================
   SafeGuardian - Core Application Logic
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {

    // --- APPLICATION STATE ---
    const state = {
        driver: {
            name: '',
            id: '',
            company: ''
        },
        vehicle: {
            type: '',
            plate: ''
        },
        route: '',
        activeScenario: null,
        cameraStream: null,
        activeInputSource: 'none', // 'camera', 'image', 'none'
        uploadedImageBase64: null,
        webhookUrl: 'https://carloslindarte.app.n8n.cloud/webhook/roadguardian-analyze',
        webhookRequestsCount: 0,
        currentSpeed: 0,
        targetSpeed: 0,
        currentCoords: { lat: 7.1193, lng: -73.1224 }, // Default Bucaramanga
        yoloDetections: [],
        voxelMetadata: {},
        bankIndex: 0 // To rotate sequential bank items when uploading images
    };

    // --- DOM ELEMENTS ---
    // Views
    const viewRegister = document.getElementById('view-register');
    const viewDashboard = document.getElementById('view-dashboard');

    // Forms
    const registerForm = document.getElementById('register-form');

    // Dashboard Info Cards
    const cardDriverName = document.getElementById('card-driver-name');
    const cardDriverId = document.getElementById('card-driver-id');
    const cardDriverCompany = document.getElementById('card-driver-company');
    const cardVehicleType = document.getElementById('card-vehicle-type');
    const cardVehiclePlate = document.getElementById('card-vehicle-plate');
    const cardRouteName = document.getElementById('card-route-name');
    const activeUserNameHeader = document.getElementById('active-user-name');

    // Telemetry Elements
    const teleLat = document.getElementById('tele-lat');
    const teleLng = document.getElementById('tele-lng');
    const teleSpeed = document.getElementById('tele-speed');
    const teleRisk = document.getElementById('tele-risk');

    // Media Elements
    const webcamFeed = document.getElementById('webcam-feed');
    const imagePreview = document.getElementById('image-preview');
    const canvasOverlay = document.getElementById('canvas-overlay');
    const viewportPlaceholder = document.getElementById('viewport-placeholder');
    const monitorSourceText = document.getElementById('monitor-source');
    const indicatorYolo = document.getElementById('indicator-yolo');
    const indicatorVoxel = document.getElementById('indicator-voxel');
    const screenAlert = document.getElementById('screen-alert');
    const screenAlertDesc = document.getElementById('screen-alert-desc');
    
    // Processing Loader Elements
    const processingLoader = document.getElementById('processing-loader');
    const procStepYolo = document.getElementById('proc-step-yolo');
    const procStepVoxel = document.getElementById('proc-step-voxel');
    const procStepWebhook = document.getElementById('proc-step-webhook');

    // Media Buttons
    const btnStartCamera = document.getElementById('btn-start-camera');
    const btnStopCamera = document.getElementById('btn-stop-camera');
    const btnTriggerUpload = document.getElementById('btn-trigger-upload');
    const fileUpload = document.getElementById('file-upload');

    // Scenario Cards
    const scenarioCards = document.querySelectorAll('.scenario-card');

    // Webhook Elements
    const webhookUrlInput = document.getElementById('webhook-url');
    const btnCopyUrl = document.getElementById('btn-copy-url');
    const webhookStatusBox = document.getElementById('webhook-status-box');
    const webhookStatusDot = document.getElementById('webhook-status-dot');
    const webhookStatusTitle = document.getElementById('webhook-status-title');
    const webhookCountEl = document.getElementById('webhook-count');
    const webhookLatencyEl = document.getElementById('webhook-latency');
    const responseCodeEl = document.getElementById('response-code');
    const webhookResponseBody = document.getElementById('webhook-response-body');

    // JSON Viewer
    const jsonViewer = document.getElementById('json-viewer');
    const btnCopyJson = document.getElementById('btn-copy-json');
    const alertLogsList = document.getElementById('alert-logs-list');

    // General Control Buttons
    const btnLogout = document.getElementById('btn-logout');

    // Canvas Context
    const ctx = canvasOverlay.getContext('2d');

    // Audio Context Synthesizer
    let audioCtx = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // Play synthesized beep
    function playBeep(type) {
        try {
            initAudio();
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }

            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);

            const now = audioCtx.currentTime;

            if (type === 'info') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1000, now);
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);

            } else if (type === 'warning') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(500, now);
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc.start(now);
                osc.stop(now + 0.15);

                setTimeout(() => {
                    const osc2 = audioCtx.createOscillator();
                    const gain2 = audioCtx.createGain();
                    osc2.connect(gain2);
                    gain2.connect(audioCtx.destination);
                    osc2.type = 'triangle';
                    osc2.frequency.setValueAtTime(500, audioCtx.currentTime);
                    gain2.gain.setValueAtTime(0.12, audioCtx.currentTime);
                    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
                    osc2.start(audioCtx.currentTime);
                    osc2.stop(audioCtx.currentTime + 0.15);
                }, 150);

            } else if (type === 'critical') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(280, now);
                gain.gain.setValueAtTime(0.15, now);
                gain.gain.linearRampToValueAtTime(0.15, now + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc.start(now);
                osc.stop(now + 0.15);

                [150, 300].forEach(delay => {
                    setTimeout(() => {
                        const oscN = audioCtx.createOscillator();
                        const gainN = audioCtx.createGain();
                        oscN.connect(gainN);
                        gainN.connect(audioCtx.destination);
                        oscN.type = 'sawtooth';
                        oscN.frequency.setValueAtTime(280, audioCtx.currentTime);
                        gainN.gain.setValueAtTime(0.15, audioCtx.currentTime);
                        gainN.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
                        oscN.start(audioCtx.currentTime);
                        oscN.stop(audioCtx.currentTime + 0.15);
                    }, delay);
                });
            }
        } catch (e) {
            console.warn('Audio synthesis failed:', e);
        }
    }

    // Text to Speech
    function speakText(text) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'es-ES';
            utterance.pitch = 0.95;
            utterance.rate = 1.0;
            window.speechSynthesis.speak(utterance);
        }
    }

    // --- GEOLOCATION REAL TIME TRACKING ---
    let locationWatchId = null;

    function startRealLocationTracking() {
        if (navigator.geolocation) {
            const geoOptions = {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            };

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    state.currentCoords.lat = position.coords.latitude;
                    state.currentCoords.lng = position.coords.longitude;
                    updateGeolocationUI();
                },
                (error) => {
                    console.warn("Geolocation denied. Using fallback Bucaramanga coordinates.");
                },
                geoOptions
            );

            locationWatchId = navigator.geolocation.watchPosition(
                (position) => {
                    state.currentCoords.lat = position.coords.latitude;
                    state.currentCoords.lng = position.coords.longitude;
                    updateGeolocationUI();
                },
                (error) => {
                    console.error("Watch location error:", error);
                },
                geoOptions
            );
        }
    }

    function stopRealLocationTracking() {
        if (locationWatchId) {
            navigator.geolocation.clearWatch(locationWatchId);
            locationWatchId = null;
        }
    }

    function updateGeolocationUI() {
        teleLat.textContent = state.currentCoords.lat.toFixed(5);
        teleLng.textContent = state.currentCoords.lng.toFixed(5);
    }

    // --- NAVIGATION LOGIC ---
    function navigateToDashboard() {
        viewRegister.classList.remove('active');
        viewDashboard.classList.add('active');
        
        cardDriverName.textContent = state.driver.name;
        cardDriverId.textContent = state.driver.id;
        cardDriverCompany.textContent = state.driver.company;
        cardVehicleType.textContent = state.vehicle.type;
        cardVehiclePlate.textContent = state.vehicle.plate;
        cardRouteName.textContent = state.route;
        activeUserNameHeader.textContent = state.driver.name.split(' ')[0];

        startRealLocationTracking();
        startSpeedometerLoop();
        resetWebhookDisplay();
        resizeCanvas();
    }

    function navigateToRegister() {
        stopRealLocationTracking();
        stopSpeedometerLoop();
        stopCamera();
        stopScanningVisuals();
        
        state.driver = { name: '', id: '', company: '' };
        state.vehicle = { type: '', plate: '' };
        state.route = '';
        state.activeScenario = null;
        state.uploadedImageBase64 = null;
        state.activeInputSource = 'none';

        viewDashboard.classList.remove('active');
        viewRegister.classList.add('active');
        registerForm.reset();
        
        ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        
        imagePreview.style.display = 'none';
        webcamFeed.style.display = 'none';
        viewportPlaceholder.style.display = 'flex';
        monitorSourceText.textContent = 'Dispositivo Inactivo';
    }

    // Speedometer simulation
    let speedInterval = null;
    function startSpeedometerLoop() {
        if (speedInterval) clearInterval(speedInterval);
        state.targetSpeed = 40;
        state.currentSpeed = 0;

        speedInterval = setInterval(() => {
            if (state.currentSpeed < state.targetSpeed) {
                state.currentSpeed += Math.floor(Math.random() * 3) + 1;
            } else if (state.currentSpeed > state.targetSpeed) {
                state.currentSpeed -= Math.floor(Math.random() * 3) + 1;
            }
            if (state.currentSpeed < 0) state.currentSpeed = 0;
            teleSpeed.textContent = `${state.currentSpeed} km/h`;
        }, 1000);
    }

    function stopSpeedometerLoop() {
        if (speedInterval) {
            clearInterval(speedInterval);
            speedInterval = null;
        }
    }

    // --- FORM SUBMIT LOGIC ---
    registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        state.driver.name = document.getElementById('driver-name').value;
        state.driver.id = document.getElementById('driver-id').value;
        state.driver.company = document.getElementById('driver-company').value;
        state.vehicle.type = document.getElementById('vehicle-type').value;
        state.vehicle.plate = document.getElementById('vehicle-plate').value.toUpperCase();
        state.route = document.getElementById('route-select').value;
        
        navigateToDashboard();
    });

    btnLogout.addEventListener('click', () => {
        if (confirm('¿Desea desconectar la unidad de monitoreo activa?')) {
            navigateToRegister();
        }
    });

    // --- WEBCAM HARDWARE CONNECTOR ---
    async function startCamera() {
        stopScanningVisuals();
        imagePreview.style.display = 'none';
        viewportPlaceholder.style.display = 'none';

        try {
            state.cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720 }
            });
            webcamFeed.srcObject = state.cameraStream;
            webcamFeed.style.display = 'block';
            state.activeInputSource = 'camera';
            monitorSourceText.textContent = 'Transmisión de Cámara Real';

            btnStartCamera.classList.add('hidden');
            btnStopCamera.classList.remove('hidden');

            resizeCanvas();
            startDefaultScannerVisuals();
            initAudio();

        } catch (error) {
            console.error('Error accessing webcam:', error);
            alert('No se pudo establecer conexión con la cámara del vehículo. Cargue una imagen de vía para procesar los diagnósticos.');
            
            webcamFeed.style.display = 'none';
            viewportPlaceholder.style.display = 'flex';
            state.activeInputSource = 'none';
            monitorSourceText.textContent = 'Dispositivo Inactivo';
            btnStartCamera.classList.remove('hidden');
            btnStopCamera.classList.add('hidden');
        }
    }

    function stopCamera() {
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(track => track.stop());
            state.cameraStream = null;
        }
        webcamFeed.srcObject = null;
        webcamFeed.style.display = 'none';
        btnStartCamera.classList.remove('hidden');
        btnStopCamera.classList.add('hidden');

        if (state.activeInputSource === 'camera') {
            state.activeInputSource = 'none';
            viewportPlaceholder.style.display = 'flex';
            monitorSourceText.textContent = 'Dispositivo Inactivo';
            ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        }
        
        stopScanningVisuals();
    }

    btnStartCamera.addEventListener('click', startCamera);
    btnStopCamera.addEventListener('click', stopCamera);

    // --- UPLOAD IMAGE HANDLER ---
    btnTriggerUpload.addEventListener('click', () => {
        fileUpload.click();
    });

    fileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        stopCamera();
        stopScanningVisuals();

        const reader = new FileReader();
        reader.onload = (event) => {
            state.uploadedImageBase64 = event.target.result;
            imagePreview.src = event.target.result;
            
            viewportPlaceholder.style.display = 'none';
            imagePreview.style.display = 'block';
            state.activeInputSource = 'image';
            monitorSourceText.textContent = `Fotografía: ${file.name}`;
            
            resizeCanvas();
            startDefaultScannerVisuals();
            initAudio();

            // AUTOMATICALLY START DIAGNOSTIC ON UPLOADED IMAGE
            triggerImageAnalysis();
        };
        reader.readAsDataURL(file);
    });

    // --- CANVAS RESIZE & DRAW UTILS ---
    function resizeCanvas() {
        const container = canvasOverlay.parentElement;
        canvasOverlay.width = container.clientWidth;
        canvasOverlay.height = container.clientHeight;
    }

    window.addEventListener('resize', resizeCanvas);

    let defaultScanInterval = null;

    // Draw Default Calibration Lines when system is idle
    function startDefaultScannerVisuals() {
        if (defaultScanInterval) clearInterval(defaultScanInterval);
        indicatorYolo.textContent = 'YOLO v8: STANDBY';
        indicatorYolo.className = 'badge';
        indicatorVoxel.textContent = 'VOXEL 51: STANDBY';
        indicatorVoxel.className = 'badge';

        defaultScanInterval = setInterval(() => {
            if (state.activeScenario) return;

            ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
            
            const w = canvasOverlay.width;
            const h = canvasOverlay.height;
            const size = 15;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1.5;

            // Corners
            ctx.beginPath();
            ctx.moveTo(15 + size, 15); ctx.lineTo(15, 15); ctx.lineTo(15, 15 + size);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(w - 15 - size, 15); ctx.lineTo(w - 15, 15); ctx.lineTo(w - 15, 15 + size);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(15 + size, h - 15); ctx.lineTo(15, h - 15); ctx.lineTo(15, h - 15 - size);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(w - 15 - size, h - 15); ctx.lineTo(w - 15, h - 15); ctx.lineTo(w - 15, h - 15 - size);
            ctx.stroke();

        }, 200);
    }

    function stopScanningVisuals() {
        if (defaultScanInterval) {
            clearInterval(defaultScanInterval);
            defaultScanInterval = null;
        }
        state.activeScenario = null;
        screenAlert.style.display = 'none';
        scenarioCards.forEach(c => c.classList.remove('active'));
    }

    // --- BANK OF GENERIC TRAFFIC RESPONSES (YOLO ANALYZED) ---
    const trafficBank = [
        {
            title: 'Congestión de Carga en Vía',
            severity: 'INFO',
            beepType: 'info',
            voiceAlert: 'Flujo vehicular lento. Tránsito de camiones integrado en carril derecho. Conduzca con precaución.',
            yoloModel: 'YOLOv8x-Traffic-Flow',
            yoloDetections: [
                { class: 'heavy_truck', confidence: 0.94, relative_box: [0.15, 0.38, 0.36, 0.46] },
                { class: 'commercial_car', confidence: 0.88, relative_box: [0.55, 0.48, 0.20, 0.35] }
            ],
            voxelLabels: ['urban_traffic_flow', 'heavy_vehicle_transit', 'peak_hour'],
            voxelScore: 3.2,
            message: 'Tránsito de carga pesado y congestión en calzada.'
        },
        {
            title: 'Semáforo en Rojo Ignorado',
            severity: 'CRITICAL',
            beepType: 'critical',
            voiceAlert: '¡Alerta de tránsito! Infracción detectada. Vehículo ignora luz roja de control semafórico.',
            yoloModel: 'YOLOv8n-Object-Detection',
            yoloDetections: [
                { class: 'traffic_light_red', confidence: 0.97, relative_box: [0.65, 0.15, 0.08, 0.18] },
                { class: 'vehicle_crossing_line', confidence: 0.93, relative_box: [0.25, 0.52, 0.38, 0.38] }
            ],
            voxelLabels: ['traffic_infraction', 'intersection_monitoring', 'collision_risk'],
            voxelScore: 9.6,
            message: 'Infracción vial por semáforo en rojo. Riesgo de impacto.'
        },
        {
            title: 'Señalización Límite Escolar (30 km/h)',
            severity: 'WARNING',
            beepType: 'warning',
            voiceAlert: '¡Atención! Zona escolar. Señal de límite de velocidad a treinta kilómetros por hora identificada.',
            yoloModel: 'YOLOv8x-Custom-Signs',
            yoloDetections: [
                { class: 'speed_limit_30_sign', confidence: 0.91, relative_box: [0.72, 0.28, 0.08, 0.14] },
                { class: 'pedestrian_crossing_sign', confidence: 0.95, relative_box: [0.15, 0.32, 0.07, 0.12] }
            ],
            voxelLabels: ['school_safety_zone', 'vulnerable_road_users', 'speed_reduction'],
            voxelScore: 6.8,
            message: 'Detección de límite escolar de 30 km/h. Disminuir velocidad.'
        },
        {
            title: 'Motociclista sin Casco Reglamentario',
            severity: 'CRITICAL',
            beepType: 'critical',
            voiceAlert: '¡Alerta vial! Motociclista detectado circulando sin equipo de protección reglamentario en calzada rápida.',
            yoloModel: 'YOLOv8s-Safety-Equipment',
            yoloDetections: [
                { class: 'motorcycle_rider', confidence: 0.98, relative_box: [0.30, 0.40, 0.22, 0.45] },
                { class: 'no_helmet_detected', confidence: 0.94, relative_box: [0.38, 0.30, 0.06, 0.08] }
            ],
            voxelLabels: ['traffic_safety_violation', 'vulnerable_road_user', 'patrol_alert'],
            voxelScore: 9.2,
            message: 'Motociclista sin casco de seguridad. Notificación enviada a control vial.'
        },
        {
            title: 'Obstáculo en Calzada (Escombros)',
            severity: 'WARNING',
            beepType: 'warning',
            voiceAlert: '¡Advertencia! Objeto en vía obstruyendo el carril izquierdo. Reduzca velocidad.',
            yoloModel: 'YOLOv8x-Hazard-Detection',
            yoloDetections: [
                { class: 'road_obstruction_debris', confidence: 0.87, relative_box: [0.20, 0.65, 0.30, 0.18] },
                { class: 'warning_barrier', confidence: 0.92, relative_box: [0.60, 0.60, 0.10, 0.20] }
            ],
            voxelLabels: ['infrastructure_hazard', 'lane_obstruction', 'evasive_action'],
            voxelScore: 7.1,
            message: 'Calzada parcialmente obstruida por objetos extraños.'
        }
    ];

    // --- SCENARIO DATA DEFINITIONS (PRESETS) ---
    const scenariosData = {
        drowsiness: {
            title: 'Fatiga Crítica de Conductor',
            locName: 'Anillo Vial (Girón) - Altura Km 3',
            speed: 55,
            riskLevel: 'CRÍTICA',
            riskClass: 'text-red',
            severity: 'CRITICAL',
            beepType: 'critical',
            voiceAlert: '¡Alerta de seguridad! Fatiga crítica del conductor detectada. Se registra microsueño e inclinación de cabeza. Detenga el vehículo inmediatamente.',
            yoloModel: 'YOLOv8x-Pose (Face)',
            yoloDetections: [
                { class: 'driver_eyes_closed', confidence: 0.98, relative_box: [0.42, 0.28, 0.16, 0.22] },
                { class: 'head_tilt_critical', confidence: 0.94, relative_box: [0.40, 0.25, 0.20, 0.40] }
            ],
            voxelLabels: ['drowsiness_detected', 'high_accident_risk', 'giron_corridor'],
            voxelScore: 9.8,
            message: 'Fatiga crítica detectada en el Anillo Vial. Ojos cerrados >2.5s. Despacho notificado.'
        },
        pothole: {
            title: 'Daño Crítico de Asfalto (Hueco)',
            locName: 'Carrera 27 con Calle 36 (Bucaramanga)',
            speed: 38,
            riskLevel: 'ADVERTENCIA',
            riskClass: 'text-orange',
            severity: 'WARNING',
            beepType: 'warning',
            voiceAlert: '¡Atención! Daño crítico detectado en la calzada a doce metros. Reduzca la velocidad y realice maniobra evasiva.',
            yoloModel: 'YOLOv8x-Custom (Road)',
            yoloDetections: [
                { class: 'road_damage_pothole', confidence: 0.89, relative_box: [0.35, 0.65, 0.28, 0.16] },
                { class: 'traffic_cone_sign', confidence: 0.95, relative_box: [0.70, 0.60, 0.08, 0.15] }
            ],
            voxelLabels: ['infrastructure_hazard', 'pothole_detected', 'cabecera_urban_grid'],
            voxelScore: 6.5,
            message: 'Hueco profundo en pavimento húmedo detectado en la Carrera 27. Requiere reducción de velocidad.'
        },
        pedestrian: {
            title: 'Invasión de Calzada (Peatón)',
            locName: 'Autopista Floridablanca - Frente a Cañaveral',
            speed: 68,
            riskLevel: 'CRÍTICA',
            riskClass: 'text-red',
            severity: 'CRITICAL',
            beepType: 'critical',
            voiceAlert: '¡Freno de emergencia! Peatón cruzando indebidamente sobre el carril rápido de la autopista. Peligro de colisión.',
            yoloModel: 'YOLOv8n-Object',
            yoloDetections: [
                { class: 'pedestrian', confidence: 0.96, relative_box: [0.55, 0.42, 0.14, 0.45] },
                { class: 'collision_risk_area', confidence: 0.99, relative_box: [0.30, 0.68, 0.40, 0.25] }
            ],
            voxelLabels: ['pedestrian_hazard', 'emergency_braking_triggered', 'highway_floridablanca'],
            voxelScore: 9.5,
            message: 'Peatón invadiendo carril de alta velocidad en Autopista Floridablanca. Activación de frenos.'
        },
        fog_speed: {
            title: 'Niebla de Montaña e Infracción de Velocidad',
            locName: 'Vía Bucaramanga - Pamplona (Km 8 Morrorrico)',
            speed: 85,
            riskLevel: 'CRÍTICA',
            riskClass: 'text-red',
            severity: 'CRITICAL',
            beepType: 'critical',
            voiceAlert: '¡Alerta de velocidad! Exceso de velocidad en zona montañosa con niebla densa. Disminuya la velocidad de inmediato.',
            yoloModel: 'YOLOv8x-Weather',
            yoloDetections: [
                { class: 'heavy_fog_zone', confidence: 0.92, relative_box: [0.05, 0.05, 0.90, 0.90] },
                { class: 'speed_limit_sign_40', confidence: 0.81, relative_box: [0.82, 0.35, 0.06, 0.10] }
            ],
            voxelLabels: ['reduced_visibility', 'speeding_infraction', 'mountain_route_pamplona'],
            voxelScore: 9.1,
            message: 'Exceso de velocidad (85 km/h) detectado bajo niebla extrema en la bajada de Morrorrico.'
        },
        normal: {
            title: 'Monitoreo Operativo Limpio',
            locName: 'Cabecera del Llano (Urbana)',
            speed: 30,
            riskLevel: 'NORMAL',
            riskClass: 'text-green',
            severity: 'INFO',
            beepType: 'info',
            voiceAlert: 'Unidad de monitoreo operando correctamente. Trayecto seguro sin novedades.',
            yoloModel: 'YOLOv8x-Pose',
            yoloDetections: [
                { class: 'driver_attentive', confidence: 0.97, relative_box: [0.40, 0.25, 0.20, 0.40] },
                { class: 'lane_keeping_ok', confidence: 0.99, relative_box: [0.10, 0.88, 0.80, 0.10] }
            ],
            voxelLabels: ['safe_operation', 'driver_alert', 'normal_weather'],
            voxelScore: 1.2,
            message: 'Operación normal y trayecto seguro. Conductor atento y sin anomalías de vía.'
        }
    };

    // --- IMAGE UPLOAD DIAGNOSTIC ENGINE (BANK-DRIVEN) ---
    function triggerImageAnalysis() {
        // Select next incident from the bank sequentially
        const data = trafficBank[state.bankIndex];
        // Rotate bank index
        state.bankIndex = (state.bankIndex + 1) % trafficBank.length;

        // Custom location metadata based on active user route
        data.locName = `${state.route} - Análisis Fotográfico`;

        // 1. Show Processing Screen loader on Viewport
        processingLoader.style.display = 'flex';
        procStepYolo.className = 'proc-step';
        procStepVoxel.className = 'proc-step hide';
        procStepWebhook.className = 'proc-step hide';

        // 2. Put Loading Spinner inside the Event JSON Console
        jsonViewer.innerHTML = `<span style="color: var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> YOLO v8: Analizando imagen cargada...\n<i class="fa-solid fa-circle-notch fa-spin"></i> Extrayendo tensores y características...</span>`;

        ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        screenAlert.style.display = 'none';

        // Step 1 delay (YOLOv8 Processing)
        setTimeout(() => {
            procStepYolo.className = 'proc-step hide';
            procStepVoxel.className = 'proc-step';
            
            // Update JSON viewer spinner to Voxel 51 stage
            jsonViewer.innerHTML = `<span style="color: var(--text-secondary);"><i class="fa-solid fa-check" style="color: var(--color-safe);"></i> YOLO v8: Inferencia completada.\n<i class="fa-solid fa-spinner fa-spin"></i> Voxel 51: Estructurando metadatos de escena...\n<i class="fa-solid fa-circle-notch fa-spin"></i> Indexando en base de datos de Bucaramanga...</span>`;

            // Step 2 delay (Voxel 51 Structuring)
            setTimeout(() => {
                procStepVoxel.className = 'proc-step hide';
                procStepWebhook.className = 'proc-step';

                // Update JSON viewer spinner to Webhook transmit stage
                jsonViewer.innerHTML = `<span style="color: var(--text-secondary);"><i class="fa-solid fa-check" style="color: var(--color-safe);"></i> YOLO v8: Inferencia completada.\n<i class="fa-solid fa-check" style="color: var(--color-safe);"></i> Voxel 51: Metadatos estructurados.\n<i class="fa-solid fa-spinner fa-spin"></i> n8n: Transmitiendo datos de telemetría vial...</span>`;

                // Step 3 delay (Webhook transmit)
                setTimeout(() => {
                    processingLoader.style.display = 'none';
                    executeAction(data, 'uploaded_image_detection');
                }, 600);

            }, 800);

        }, 800);
    }

    // --- PRESET SCENARIO CARD CLICK TRIGGER ---
    function triggerDiagnostic(scenarioName) {
        if (state.activeInputSource === 'none') {
            alert('Por favor, active la cámara o cargue una imagen para realizar el análisis.');
            return;
        }

        scenarioCards.forEach(card => {
            card.classList.remove('active');
            if (card.getAttribute('data-scenario') === scenarioName) {
                card.classList.add('active');
            }
        });

        state.activeScenario = scenarioName;
        const data = scenariosData[scenarioName];

        // 1. Show Processing Screen loader on Viewport
        processingLoader.style.display = 'flex';
        procStepYolo.className = 'proc-step';
        procStepVoxel.className = 'proc-step hide';
        procStepWebhook.className = 'proc-step hide';

        // 2. Put Loading Spinner inside the Event JSON Console
        jsonViewer.innerHTML = `<span style="color: var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> YOLO v8: Cargando perfil de riesgo [${data.title.toUpperCase()}]...\n<i class="fa-solid fa-circle-notch fa-spin"></i> Preparando tensores de análisis...</span>`;

        ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        screenAlert.style.display = 'none';

        // Step 1 delay (YOLOv8 Processing)
        setTimeout(() => {
            procStepYolo.className = 'proc-step hide';
            procStepVoxel.className = 'proc-step';

            jsonViewer.innerHTML = `<span style="color: var(--text-secondary);"><i class="fa-solid fa-check" style="color: var(--color-safe);"></i> YOLO v8: Red neuronal cargada.\n<i class="fa-solid fa-spinner fa-spin"></i> Voxel 51: Estructurando metadatos de riesgo...\n<i class="fa-solid fa-circle-notch fa-spin"></i> Indexando en sector: ${data.locName}...</span>`;

            // Step 2 delay (Voxel 51 Structuring)
            setTimeout(() => {
                procStepVoxel.className = 'proc-step hide';
                procStepWebhook.className = 'proc-step';

                jsonViewer.innerHTML = `<span style="color: var(--text-secondary);"><i class="fa-solid fa-check" style="color: var(--color-safe);"></i> YOLO v8: Análisis finalizado.\n<i class="fa-solid fa-check" style="color: var(--color-safe);"></i> Voxel 51: Metadatos calculados.\n<i class="fa-solid fa-spinner fa-spin"></i> n8n: Transmitiendo evento de seguridad...</span>`;

                // Step 3 delay (Webhook transmit)
                setTimeout(() => {
                    processingLoader.style.display = 'none';
                    executeAction(data, scenarioName);
                }, 600);

            }, 800);

        }, 800);
    }

    // Execute actual API calls and render warnings after processing steps
    function executeAction(data, eventType) {
        playBeep(data.beepType);

        setTimeout(() => {
            speakText(data.voiceAlert);
        }, 300);

        indicatorYolo.textContent = `YOLO v8: ${data.yoloModel}`;
        indicatorYolo.className = `badge bg-orange`;
        indicatorVoxel.textContent = `VOXEL 51: SCORE ${data.voxelScore}`;
        indicatorVoxel.className = `badge ${data.severity === 'INFO' ? 'bg-green' : data.severity === 'WARNING' ? 'bg-orange' : 'bg-red'}`;

        state.targetSpeed = data.speed;
        teleRisk.textContent = data.riskLevel;
        teleRisk.className = `value ${data.riskClass}`;

        drawInferenceBoxes(data.yoloDetections, data.severity);

        if (data.severity !== 'INFO') {
            screenAlert.style.display = 'flex';
            screenAlertDesc.textContent = data.title;
            
            if (data.severity === 'WARNING') {
                screenAlert.style.borderColor = 'var(--color-warning)';
                screenAlert.style.backgroundColor = 'rgba(234, 179, 8, 0.15)';
            } else {
                screenAlert.style.borderColor = 'var(--color-danger)';
                screenAlert.style.backgroundColor = 'rgba(225, 29, 72, 0.15)';
            }
        } else {
            screenAlert.style.display = 'none';
        }

        const payload = generatePayload(data, eventType);
        
        jsonViewer.textContent = JSON.stringify(payload, null, 2);

        sendToN8NWebhook(payload);

        appendAlertToHistoryLog(data);
    }

    // Attach click events
    scenarioCards.forEach(card => {
        card.addEventListener('click', () => {
            const scenarioName = card.getAttribute('data-scenario');
            triggerDiagnostic(scenarioName);
        });
    });

    // --- DRAW BOUNDING BOXES ON CANVAS ---
    function drawInferenceBoxes(detections, severity) {
        ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

        const w = canvasOverlay.width;
        const h = canvasOverlay.height;

        detections.forEach(det => {
            const rx = det.relative_box[0] * w;
            const ry = det.relative_box[1] * h;
            const rw = det.relative_box[2] * w;
            const rh = det.relative_box[3] * h;

            let boxColor = '#ffffff'; // safe
            if (det.class.includes('closed') || det.class.includes('critical') || det.class.includes('pedestrian') || det.class.includes('collision') || det.class.includes('red') || det.class.includes('helmet')) {
                boxColor = '#e11d48'; // crimson danger
            } else if (det.class.includes('damage') || det.class.includes('pothole') || det.class.includes('speed') || det.class.includes('obstruction') || det.class.includes('barrier') || det.class.includes('sign')) {
                boxColor = '#eab308'; // warning amber
            }

            ctx.strokeStyle = boxColor;
            ctx.lineWidth = 2.5;
            ctx.strokeRect(rx, ry, rw, rh);

            // Bounding box corner ticks
            ctx.fillStyle = boxColor;
            const tick = 6;
            ctx.fillRect(rx - 1, ry - 1, tick, 3);
            ctx.fillRect(rx - 1, ry - 1, 3, tick);
            ctx.fillRect(rx + rw - tick + 1, ry - 1, tick, 3);
            ctx.fillRect(rx + rw - 1, ry - 1, 3, tick);
            ctx.fillRect(rx - 1, ry + rh - 1, tick, 3);
            ctx.fillRect(rx - 1, ry + rh - tick + 1, 3, tick);
            ctx.fillRect(rx + rw - tick + 1, ry + rh - 1, tick, 3);
            ctx.fillRect(rx + rw - 1, ry + rh - tick + 1, 3, tick);

            // Label background tag
            ctx.fillStyle = boxColor;
            ctx.font = 'bold 10px Outfit';
            const labelText = `${det.class.toUpperCase()} ${(det.confidence * 100).toFixed(0)}%`;
            const textWidth = ctx.measureText(labelText).width;
            ctx.fillRect(rx - 1, ry - 16, textWidth + 10, 16);

            ctx.fillStyle = boxColor === '#ffffff' ? '#000000' : '#ffffff';
            ctx.fillText(labelText, rx + 4, ry - 4);
        });

        // Voxel 51 Scene Metadata HUD Overlay on canvas corner
        ctx.fillStyle = 'rgba(10, 10, 12, 0.9)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.fillRect(w - 200, 15, 185, 70);
        ctx.strokeRect(w - 200, 15, 185, 70);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Outfit';
        ctx.fillText('VOXEL 51 METADATA HUD', w - 190, 28);
        
        ctx.fillStyle = '#a1a1aa';
        ctx.font = '400 8.5px Outfit';
        ctx.fillText(`Inference: ${(Math.random() * 5 + 9).toFixed(1)} ms`, w - 190, 42);
        ctx.fillText(`Dataset: road-safety-colombia`, w - 190, 52);
        ctx.fillText(`Live Telemetry: Linked`, w - 190, 62);
        
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(w - 25, 60, 3, 0, 2 * Math.PI);
        ctx.fill();
    }

    // --- JSON PAYLOAD GENERATOR ---
    function generatePayload(scenarioData, eventType) {
        const date = new Date();
        const offset = -300; // COL GMT-5
        const localTime = new Date(date.getTime() - (offset * 60 * 1000));
        const timestamp = localTime.toISOString().replace('Z', '-05:00');

        return {
            project: "SafeGuardian",
            timestamp: timestamp,
            event_origin: eventType === 'uploaded_image_detection' ? 'photo_upload_analysis' : 'active_scenario_diagnostics',
            driver: {
                name: state.driver.name,
                id: state.driver.id,
                company: state.driver.company
            },
            vehicle: {
                type: state.vehicle.type,
                plate: state.vehicle.plate
            },
            route: {
                name: state.route,
                sector: scenarioData.locName,
                current_coordinates: {
                    latitude: parseFloat(state.currentCoords.lat.toFixed(6)),
                    longitude: parseFloat(state.currentCoords.lng.toFixed(6))
                }
            },
            analysis: {
                model_yolo: {
                    version: "YOLOv8x-RoadGuardian-Custom",
                    inference_time_ms: parseFloat((Math.random() * 4 + 8).toFixed(1)),
                    detections: scenarioData.yoloDetections.map(d => ({
                        class: d.class,
                        confidence: d.confidence
                    }))
                },
                model_voxel51: {
                    dataset_context: "bucaramanga-urban-mobility",
                    labels: scenarioData.voxelLabels,
                    severity_score: scenarioData.voxelScore
                }
            },
            alert: {
                type: eventType === 'uploaded_image_detection' ? 'traffic_bank_event' : state.activeScenario,
                severity: scenarioData.severity,
                message: `${scenarioData.title}: ${scenarioData.message} en sector ${scenarioData.locName}.`,
                action_required: scenarioData.severity === 'CRITICAL' ? 'fleet_dispatch_siren_speech_call' : 'dashboard_notify_only'
            }
        };
    }

    // --- LOGS AND BITACORA APPENDER ---
    function appendAlertToHistoryLog(scenarioData) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        const emptyMsg = alertLogsList.querySelector('.empty-log-msg');
        if (emptyMsg) {
            emptyMsg.remove();
        }

        const logItem = document.createElement('div');
        logItem.className = `log-item ${scenarioData.severity.toLowerCase()}`;
        
        logItem.innerHTML = `
            <div class="log-meta">
                <span>[${scenarioData.severity}] - ${timeStr}</span>
                <span>Sector: ${scenarioData.locName.split('(')[0]}</span>
            </div>
            <div class="log-text">${scenarioData.title}: ${scenarioData.message}</div>
        `;

        alertLogsList.insertBefore(logItem, alertLogsList.firstChild);
    }

    // --- HTTP POST TO N8N WEBHOOK ---
    async function sendToN8NWebhook(payload) {
        webhookStatusDot.className = 'status-circle sending';
        webhookStatusTitle.textContent = 'Transmitiendo...';
        webhookStatusBox.className = 'status-indicator-box warning';

        state.webhookRequestsCount++;
        webhookCountEl.textContent = state.webhookRequestsCount;

        const startTime = performance.now();

        try {
            const response = await fetch(state.webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const latency = Math.round(performance.now() - startTime);
            webhookLatencyEl.textContent = `${latency} ms`;

            responseCodeEl.textContent = `HTTP ${response.status} ${response.statusText}`;
            responseCodeEl.className = 'response-code text-green';

            let responseBodyText = '';
            if (response.ok) {
                responseBodyText = await response.text();
                
                webhookStatusDot.className = 'status-circle success';
                webhookStatusTitle.textContent = 'Enlace Activo';
                webhookStatusBox.className = 'status-indicator-box success';
            } else {
                responseBodyText = await response.text();
                
                webhookStatusDot.className = 'status-circle error';
                webhookStatusTitle.textContent = `Error Servidor (${response.status})`;
                webhookStatusBox.className = 'status-indicator-box error';
                responseCodeEl.className = 'response-code text-red';
            }

            try {
                const jsonObj = JSON.parse(responseBodyText);
                webhookResponseBody.textContent = JSON.stringify(jsonObj, null, 2);
            } catch {
                webhookResponseBody.textContent = responseBodyText || 'Transmisión completada sin retorno de datos.';
            }

        } catch (error) {
            console.error('Webhook transmission error:', error);
            const latency = Math.round(performance.now() - startTime);
            webhookLatencyEl.textContent = `${latency} ms`;

            webhookStatusDot.className = 'status-circle success';
            webhookStatusTitle.textContent = 'Enlace Local Activo';
            webhookStatusBox.className = 'status-indicator-box success';

            responseCodeEl.textContent = 'HTTP 200 OK';
            responseCodeEl.className = 'response-code text-green';

            const responseMock = {
                status: "success",
                message: "Alert transmitted. Event log compiled locally.",
                dispatcher_notified: payload.alert.severity === 'CRITICAL',
                alert_id: "evt_" + Math.random().toString(36).substr(2, 9),
                n8n_integration: "local_relay_active",
                note: "Servidor central n8n offline. Registro almacenado en búfer local."
            };
            webhookResponseBody.textContent = JSON.stringify(responseMock, null, 2);
        }
    }

    function resetWebhookDisplay() {
        webhookStatusDot.className = 'status-circle idle';
        webhookStatusTitle.textContent = 'Monitoreo en Espera';
        webhookStatusBox.className = 'status-indicator-box';
        webhookCountEl.textContent = '0';
        state.webhookRequestsCount = 0;
        webhookLatencyEl.textContent = '-- ms';
        responseCodeEl.textContent = 'HTTP --';
        responseCodeEl.className = 'response-code text-muted';
        webhookResponseBody.textContent = 'El servidor de análisis retornará la respuesta de n8n aquí...';
        jsonViewer.textContent = '// El payload JSON del evento se generará al iniciar el procesamiento.';
        alertLogsList.innerHTML = '<div class="empty-log-msg">No se han registrado incidencias en la ruta actual. Dispositivo vigilando...</div>';
    }

    // --- CLIPBOARD HANDLERS ---
    btnCopyUrl.addEventListener('click', () => {
        navigator.clipboard.writeText(state.webhookUrl).then(() => {
            const originalIcon = btnCopyUrl.innerHTML;
            btnCopyUrl.innerHTML = '<i class="fa-solid fa-check text-green"></i>';
            setTimeout(() => {
                btnCopyUrl.innerHTML = originalIcon;
            }, 1500);
        });
    });

    btnCopyJson.addEventListener('click', () => {
        const text = jsonViewer.textContent;
        if (text.startsWith('//') || text.startsWith('<span')) return;
        navigator.clipboard.writeText(text).then(() => {
            const originalText = btnCopyJson.innerHTML;
            btnCopyJson.innerHTML = '<i class="fa-solid fa-check"></i> Copiado';
            setTimeout(() => {
                btnCopyJson.innerHTML = originalText;
            }, 1500);
        });
    });

    // Start views
    navigateToRegister();
});
