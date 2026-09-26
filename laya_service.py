import os
import sys
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# Prevent TensorFlow abseil deadlock
os.environ["USE_TF"] = "0"

import laya

app = FastAPI(title="Laya System-1 Service for Dota 2")
agent = None

@app.on_event("startup")
def startup_event():
    global agent
    print("\n======================================================")
    print("🧠 [Laya] Инициализация модели convaiinnovations/laya")
    print("======================================================")
    try:
        # Load English root weights (~808 MB)
        agent = laya.load("convaiinnovations/laya")
        print("✅ [Laya] Модель успешно загружена и готова к решениям (~35ms)!")
    except Exception as e:
        print(f"⚠️ [Laya] Загрузка будет повторена при первом запросе: {e}")

@app.get("/health")
def health():
    return {"status": "ok", "service": "laya"}

@app.post("/v1/systemone")
async def predict_decisions(request: Request):
    global agent
    try:
        body = await request.json()
        state = body.get("state", {})
        questions = body.get("questions", {})

        if agent is None:
            agent = laya.load("convaiinnovations/laya")

        result = agent.predict(state, questions)
        answers = result.get("answers", {})
        return {"answers": answers}
    except Exception as e:
        print(f"[Laya Error] {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    print("📍 Laya сервис запускается на http://127.0.0.1:8000/v1/systemone")
    uvicorn.run(app, host="127.0.0.1", port=8000)
