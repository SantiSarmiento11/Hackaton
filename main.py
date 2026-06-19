import os
import uuid
import time
import requests
import asyncio
import random
from typing import List, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import uvicorn
import cv2
import numpy as np

# ==========================================
# MODO DE SIMULACIÓN (ESTABLECIDO EN TRUE POR DEFECTO)
# ==========================================
SIMULATION_MODE = True
scenario_counter = 0

SIMULATED_SCENARIOS = [
    {
        "risk_level": "BAJO",
        "detection": "Conducción Normal",
        "detections": [
            {
                "label": "person",
                "confidence": 0.96,
                "box_pixels": {"x_min": 150.0, "y_min": 80.0, "x_max": 480.0, "y_max": 450.0},
                "box_normalized": {"x_min": 0.23, "y_min": 0.16, "width": 0.51, "height": 0.77}
            }
        ]
    },
    {
        "risk_level": "ALTO",
        "detection": "Uso de Celular",
        "detections": [
            {
                "label": "person",
                "confidence": 0.94,
                "box_pixels": {"x_min": 150.0, "y_min": 80.0, "x_max": 480.0, "y_max": 450.0},
                "box_normalized": {"x_min": 0.23, "y_min": 0.16, "width": 0.51, "height": 0.77}
            },
            {
                "label": "cell phone",
                "confidence": 0.89,
                "box_pixels": {"x_min": 280.0, "y_min": 220.0, "x_max": 350.0, "y_max": 330.0},
                "box_normalized": {"x_min": 0.43, "y_min": 0.45, "width": 0.11, "height": 0.23}
            }
        ]
    },
    {
        "risk_level": "ALTO",
        "detection": "Fatiga Detectada",
        "detections": [
            {
                "label": "person",
                "confidence": 0.95,
                "box_pixels": {"x_min": 150.0, "y_min": 80.0, "x_max": 480.0, "y_max": 450.0},
                "box_normalized": {"x_min": 0.23, "y_min": 0.16, "width": 0.51, "height": 0.77}
            }
        ]
    },
    {
        "risk_level": "MEDIO",
        "detection": "Distracción (Consumiendo Bebida)",
        "detections": [
            {
                "label": "person",
                "confidence": 0.93,
                "box_pixels": {"x_min": 150.0, "y_min": 80.0, "x_max": 480.0, "y_max": 450.0},
                "box_normalized": {"x_min": 0.23, "y_min": 0.16, "width": 0.51, "height": 0.77}
            },
            {
                "label": "bottle",
                "confidence": 0.87,
                "box_pixels": {"x_min": 260.0, "y_min": 240.0, "x_max": 320.0, "y_max": 350.0},
                "box_normalized": {"x_min": 0.40, "y_min": 0.50, "width": 0.09, "height": 0.23}
            }
        ]
    }
]

# ==========================================
# PUNTO CLAVE 1: Inicialización de Voxel51 (FiftyOne)
# ==========================================
fo = None
dataset = None
session = None
try:
    import fiftyone as fo
    DATASET_NAME = "road_guardian_detections"
    if DATASET_NAME in fo.list_datasets():
        dataset = fo.load_dataset(DATASET_NAME)
    else:
        dataset = fo.Dataset(DATASET_NAME)
        dataset.persistent = True  # Asegura que el dataset persista entre ejecuciones

    # Lanzar la aplicación FiftyOne en segundo plano (puerto 5151)
    try:
        session = fo.launch_app(dataset, port=5151)
        print(f"[*] Voxel51 App iniciada exitosamente en http://localhost:5151")
    except Exception as e:
        print(f"[!] No se pudo iniciar la App de Voxel51 directamente (ya iniciada o recarga de uvicorn): {e}")
        session = None
except Exception as e:
    print(f"[!] No se pudo cargar FiftyOne / Voxel51: {e}")
    fo = None
    dataset = None
    session = None

# ==========================================
# PUNTO CLAVE 2: Inicialización de YOLOv8
# ==========================================
model = None
try:
    from ultralytics import YOLO
    model = YOLO("yolov8n.pt")
    print("[*] Modelo YOLOv8 cargado correctamente.")
except Exception as e:
    print(f"[!] Error al cargar YOLOv8: {e}")
    model = None

# ==========================================
# PUNTO CLAVE 3: Inicialización de OpenCV Haar Cascades (Detección de Fatiga Fallback)
# ==========================================
try:
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
    print("[*] Clasificadores Haar de OpenCV cargados correctamente.")
except Exception as e:
    print(f"[!] Error al cargar clasificadores Haar de OpenCV: {e}")
    face_cascade = None
    eye_cascade = None


app = FastAPI(
    title="RoadGuardian AI - API de Procesamiento y Exportación a Voxel51",
    description="API que recibe imágenes del frontend, ejecuta YOLO + Fatiga, reporta a n8n y exporta a Voxel51",
    version="1.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500", "http://localhost:5500", "http://127.0.0.1:8000", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directorio local de almacenamiento
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Esquemas Pydantic para la API
class BoundingBoxPixels(BaseModel):
    x_min: float
    y_min: float
    x_max: float
    y_max: float

class BoundingBoxNormalized(BaseModel):
    x_min: float
    y_min: float
    width: float
    height: float

class DetectionResult(BaseModel):
    label: str
    confidence: float
    box_pixels: BoundingBoxPixels
    box_normalized: BoundingBoxNormalized

class AnalyzeResponse(BaseModel):
    status: str
    risk_level: str
    detection: str
    timestamp: str
    image_path: str
    detections_count: int
    detections: List[DetectionResult]
    n8n_status: str
    n8n_response: Dict[str, Any]

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "dataset_name": DATASET_NAME,
        "total_samples": len(dataset),
        "voxel51_app_url": f"http://localhost:5151" if session else "Running externally"
    }

# ==========================================
# PUNTO CLAVE 4: Endpoint Principal /analyze (Alineado al Frontend)
# ==========================================
@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_image(
    media: UploadFile = File(...),
    driver_id: str = Form("Desconocido"),
    route: str = Form("Desconocido"),
    timestamp: str = Form(None),
    n8n_webhook_url: str = Form("")
):
    # Validar formato del archivo
    content_type = media.content_type
    filename_lower = media.filename.lower() if media.filename else ""
    is_image = False
    if content_type and content_type.startswith("image/"):
        is_image = True
    elif any(filename_lower.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".bmp", ".webp"]):
        is_image = True

    if not is_image:
        raise HTTPException(status_code=400, detail="El archivo enviado no es una imagen válida")

    # ==========================================
    # PUNTO CLAVE 5: Almacenamiento local de la imagen
    # ==========================================
    file_extension = os.path.splitext(media.filename)[1]
    unique_filename = f"{int(time.time())}_{uuid.uuid4().hex}{file_extension}"
    filepath = os.path.join(UPLOAD_DIR, unique_filename)
    
    try:
        content = await media.read()
        with open(filepath, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al guardar la imagen localmente: {str(e)}")

    abs_filepath = os.path.abspath(filepath)

    # ==========================================
    # VERIFICACIÓN DE MODO (SIMULADO vs REAL)
    # ==========================================
    if SIMULATION_MODE:
        # Simular retraso de procesamiento de 1.5 segundos
        await asyncio.sleep(1.5)
        
        global scenario_counter
        scenario = SIMULATED_SCENARIOS[scenario_counter % len(SIMULATED_SCENARIOS)]
        scenario_counter += 1

        risk_level = scenario["risk_level"]
        detection_summary = scenario["detection"]
        detections_response = [dict(d) for d in scenario["detections"]]
        fatigue_detected = (detection_summary == "Fatiga Detectada")

        # Intentar guardar la muestra simulada en Voxel51 (FiftyOne) si está activo
        if fo and dataset:
            try:
                detections_fo = []
                for det in detections_response:
                    box = det["box_normalized"]
                    detections_fo.append(
                        fo.Detection(
                            label=det["label"],
                            bounding_box=[box["x_min"], box["y_min"], box["width"], box["height"]],
                            confidence=det["confidence"]
                        )
                    )
                
                sample = fo.Sample(filepath=abs_filepath)
                sample["predictions"] = fo.Detections(detections=detections_fo)
                sample["driver_id"] = driver_id
                sample["route"] = route
                sample["risk_level"] = risk_level
                sample["detection_summary"] = detection_summary
                sample["frontend_timestamp"] = timestamp if timestamp else time.strftime("%Y-%m-%d %H:%M:%S")
                
                sample.save()
                dataset.add_sample(sample)
                print(f"[*] Muestra simulada guardada en Voxel51.")
            except Exception as e:
                print(f"[!] Error al exportar muestra simulada a Voxel51: {e}")

        # En el modo de simulación, la petición HTTP se envía directamente desde el frontend,
        # pero mantenemos los campos en la respuesta para preservar la estructura.
        n8n_status = "FRONTEND_DIRECT"
        n8n_res_data = {"info": "Petición HTTP enviada directamente por el Frontend (JS)"}

    else:
        # ==========================================
        # PUNTO CLAVE 6: Detección de Fatiga con OpenCV Haar Cascades (REAL)
        # ==========================================
        fatigue_detected = False
        if face_cascade and eye_cascade:
            try:
                img_cv = cv2.imread(abs_filepath)
                gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
                faces = face_cascade.detectMultiScale(gray, 1.3, 5)
                for (x, y, w, h) in faces:
                    roi_gray = gray[y:y+h, x:x+w]
                    eyes = eye_cascade.detectMultiScale(roi_gray)
                    if len(eyes) == 0:
                        fatigue_detected = True
                        break
            except Exception as e:
                print(f"[!] Error en detección de fatiga por Haar Cascades: {e}")

        # ==========================================
        # PUNTO CLAVE 7: Inferencia con YOLOv8 (Detección de Objetos REAL)
        # ==========================================
        if model is None:
            if os.path.exists(abs_filepath):
                os.remove(abs_filepath)
            raise HTTPException(status_code=500, detail="El modelo YOLOv8 no está cargado en el servidor")

        try:
            yolo_results = model(abs_filepath)
            result = yolo_results[0]
        except Exception as e:
            if os.path.exists(abs_filepath):
                os.remove(abs_filepath)
            raise HTTPException(status_code=500, detail=f"Error en la inferencia de YOLO: {str(e)}")

        class_names = result.names
        detections_fo = []
        detections_response = []

        # ==========================================
        # PUNTO CLAVE 8: Conversión de Formato YOLO a Voxel51 xywhn -> xmin,ymin,w,h
        # ==========================================
        for box in result.boxes:
            cls_id = int(box.cls[0].item())
            label = class_names[cls_id]
            confidence = float(box.conf[0].item())
            
            # YOLO xywhn: [x_center, y_center, width, height] normalizado
            x_center, y_center, w, h = box.xywhn[0].tolist()
            
            # Voxel51: [x_min, y_min, width, height] normalizado
            x_min = x_center - (w / 2)
            y_min = y_center - (h / 2)
            
            x_min = max(0.0, min(x_min, 1.0))
            y_min = max(0.0, min(y_min, 1.0))
            
            detection = fo.Detection(
                label=label,
                bounding_box=[x_min, y_min, w, h],
                confidence=confidence
            )
            detections_fo.append(detection)
            
            xyxy = box.xyxy[0].tolist()
            detections_response.append({
                "label": label,
                "confidence": confidence,
                "box_pixels": {
                    "x_min": xyxy[0],
                    "y_min": xyxy[1],
                    "x_max": xyxy[2],
                    "y_max": xyxy[3]
                },
                "box_normalized": {
                    "x_min": x_min,
                    "y_min": y_min,
                    "width": w,
                    "height": h
                }
            })

        # ==========================================
        # PUNTO CLAVE 9: Motor de Riesgo y Resumen de Alerta
        # ==========================================
        risk_level = "BAJO"
        detection_summary = "Conducción Normal"
        detected_labels = [d["label"] for d in detections_response]

        if "cell phone" in detected_labels:
            risk_level = "ALTO"
            detection_summary = "Uso de Celular"
        elif fatigue_detected:
            risk_level = "ALTO"
            detection_summary = "Fatiga Detectada"
        elif "cup" in detected_labels or "bottle" in detected_labels:
            risk_level = "MEDIO"
            detection_summary = "Distracción (Consumiendo Bebida)"
        elif len(detected_labels) > 0:
            detection_summary = f"Detectado: {', '.join(detected_labels[:2])}"

        # ==========================================
        # PUNTO CLAVE 10: Exportación e Inserción en Voxel51 (con Telemetría REAL)
        # ==========================================
        if fo and dataset:
            try:
                sample = fo.Sample(filepath=abs_filepath)
                sample["predictions"] = fo.Detections(detections=detections_fo)
                sample["driver_id"] = driver_id
                sample["route"] = route
                sample["risk_level"] = risk_level
                sample["detection_summary"] = detection_summary
                sample["frontend_timestamp"] = timestamp if timestamp else time.strftime("%Y-%m-%d %H:%M:%S")
                
                sample.save()
                dataset.add_sample(sample)
            except Exception as e:
                print(f"[!] Error al exportar la muestra a Voxel51: {e}")

        # En modo real, el backend también reporta a n8n si se le especifica una URL
        n8n_status = "NO_CONFIGURED"
        n8n_res_data = {}
        target_webhook = n8n_webhook_url if n8n_webhook_url else os.getenv("N8N_WEBHOOK_URL")
        
        if target_webhook:
            n8n_payload = {
                "driver_id": driver_id,
                "route": route,
                "risk_level": risk_level,
                "detection": detection_summary,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "image_path": abs_filepath,
                "fatigue_detected": fatigue_detected,
                "detections": [
                    {
                        "label": d["label"],
                        "confidence": d["confidence"],
                        "box_normalized": d["box_normalized"]
                    } for d in detections_response
                ]
            }
            try:
                print(f"[*] Enviando reporte de telemetría a n8n: {target_webhook}")
                res = requests.post(target_webhook, json=n8n_payload, timeout=5)
                n8n_status = "SUCCESS" if res.status_code == 200 else f"FAILED_STATUS_{res.status_code}"
                try:
                    n8n_res_data = res.json()
                except Exception:
                    n8n_res_data = {"raw_response": res.text}
            except Exception as e:
                n8n_status = f"ERROR: {str(e)}"
                n8n_res_data = {"error": str(e)}
                print(f"[!] Error al enviar petición a n8n: {e}")

    # Retornamos el formato estructurado con el veredicto de YOLO, Voxel51 y la respuesta de n8n
    return {
        "status": "PROCESADO",
        "risk_level": risk_level,
        "detection": detection_summary,
        "timestamp": time.strftime("%H:%M:%S"),
        "image_path": abs_filepath,
        "detections_count": len(detections_response),
        "detections": detections_response,
        "n8n_status": n8n_status,
        "n8n_response": n8n_res_data
    }

@app.get("/fiftyone")
def get_fiftyone_session():
    global session
    if not session:
        try:
            session = fo.launch_app(dataset, port=5151)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"No se pudo inicializar FiftyOne App: {str(e)}")
            
    return {
        "status": "FiftyOne App running",
        "url": f"http://localhost:{session.port}"
    }

# ==========================================
# PUNTO CLAVE 12: Servir Frontend y Redirección
# ==========================================
@app.get("/")
def read_root():
    return RedirectResponse(url="/static/SafeGuardian/index.html")

app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
