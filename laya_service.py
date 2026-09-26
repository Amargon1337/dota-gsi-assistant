import os
import sys
from contextlib import asynccontextmanager

# Force UTF-8 encoding on Windows to prevent UnicodeEncodeError with cp1251
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Prevent TensorFlow abseil deadlock
os.environ["USE_TF"] = "0"
os.environ["PYTHONIOENCODING"] = "utf-8"

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import laya

agent = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent
    print("\n======================================================")
    print("[Laya System-1] Инициализация модели convaiinnovations/laya")
    print("======================================================")
    try:
        agent = laya.load("convaiinnovations/laya")
        print("[Laya System-1] Модель успешно загружена и готова (~35ms)!")
    except Exception as e:
        print(f"[Laya System-1] Загрузка будет повторена при первом запросе: {e}")
    yield

app = FastAPI(title="Laya System-1 Service for Dota 2", lifespan=lifespan)

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

DOTA_TTS_REPLACEMENTS = {
    "Scythe of Vyse": "Хекс",
    "Abyssal Blade": "Абиссал",
    "Bloodthorn": "Бладторн",
    "Orchid Malevolence": "Орхид",
    "Orchid": "Орхид",
    "Swift Blink": "Свифт Блинк",
    "Arcane Blink": "Аркейн Блинк",
    "Overwhelming Blink": "Овервельминг Блинк",
    "Blink Dagger": "Блинк Даггер",
    "Blink": "Блинк",
    "Shadow Blade": "Шэдоу Блейд",
    "Silver Edge": "Сильвер",
    "Black King Bar": "БКБ",
    "BKB": "БКБ",
    "Aeon Disk": "Эон Диск",
    "Wind Waker": "Винд Вейкер",
    "Eul's Scepter": "Еул",
    "Eul": "Еул",
    "Linken's Sphere": "Линка",
    "Linken": "Линка",
    "Lotus Orb": "Лотус",
    "Lotus": "Лотус",
    "Gleipnir": "Глейпнир",
    "Rod of Atos": "Атос",
    "Atos": "Атос",
    "Diffusal Blade": "Диффузал",
    "Diffusal": "Диффузал",
    "Disperser": "Дисперсер",
    "Heaven's Halberd": "Алебарда",
    "Halberd": "Алебарда",
    "Nullifier": "Нуллифаер",
    "Skull Basher": "Башер",
    "Basher": "Башер",
    "Divine Rapier": "Рапира",
    "Rapier": "Рапира",
    "Gem of True Sight": "Гем",
    "Gem": "Гем",
    "Radiance": "Радианс",
    "Refresher Orb": "Рефрешер",
    "Refresher": "Рефрешер",
    "Spirit Vessel": "Вессел",
    "Vessel": "Вессел",
    "Manta Style": "Манта",
    "Manta": "Манта",
    "Storm Spirit": "Шторм Спирит",
    "Phantom Assassin": "Фантомка",
    "Anti-Mage": "Антимаг",
    "Antimage": "Антимаг",
    "Shadow Fiend": "Шадоу Финд",
    "Juggernaut": "Джаггернаут",
    "Axe": "Акс",
    "Pudge": "Падж",
    "Invoker": "Инвокер",
}

def normalize_dota_terms_for_tts(text: str) -> str:
    import re
    # Replace known terms (longest phrases first)
    for term in sorted(DOTA_TTS_REPLACEMENTS.keys(), key=len, reverse=True):
        text = re.sub(re.escape(term), DOTA_TTS_REPLACEMENTS[term], text, flags=re.IGNORECASE)
    # Transliterate isolated English letters like Lvl -> лвл
    text = re.sub(r'\b(?:Lvl|lvl)\b', 'уровень', text, flags=re.IGNORECASE)
    return text

@app.post("/v1/tts")
async def generate_speech(request: Request):
    try:
        import hashlib
        import edge_tts

        body = await request.json()
        raw_text = (body.get("text") or "").strip()
        if not raw_text:
            return JSONResponse(status_code=400, content={"error": "Text is required"})

        normalized_text = normalize_dota_terms_for_tts(raw_text)
        primary_voice = body.get("voice", "ru-RU-SvetlanaNeural")
        fallback_voice = "en-US-EmmaMultilingualNeural"

        text_hash = hashlib.md5(f"{primary_voice}_{normalized_text}".encode("utf-8")).hexdigest()
        cache_dir = os.path.join(os.path.dirname(__file__), "public", "audio_cache")
        os.makedirs(cache_dir, exist_ok=True)
        file_path = os.path.join(cache_dir, f"{text_hash}.mp3")

        if not os.path.exists(file_path) or os.path.getsize(file_path) < 1000:
            audio_bytes = bytearray()
            # Try primary voice first
            try:
                communicate = edge_tts.Communicate(normalized_text, primary_voice)
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_bytes.extend(chunk["data"])
            except Exception as e_primary:
                print(f"[TTS Warning] Primary voice {primary_voice} failed: {e_primary}, attempting fallback to {fallback_voice}", flush=True)
                audio_bytes.clear()
                communicate = edge_tts.Communicate(raw_text, fallback_voice)
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_bytes.extend(chunk["data"])

            if not audio_bytes:
                raise RuntimeError("No audio data generated from any voice provider")

            with open(file_path, "wb") as f:
                f.write(audio_bytes)

        return {
            "success": True,
            "audioUrl": f"/audio_cache/{text_hash}.mp3",
            "file": f"{text_hash}.mp3"
        }
    except Exception as e:
        print(f"[TTS Error] {e}", flush=True)
        return JSONResponse(status_code=500, content={"error": str(e), "fallbackToWebSpeech": True})

if __name__ == "__main__":
    print("[Laya System-1] Сервис запускается на http://127.0.0.1:8000/v1/systemone")
    uvicorn.run(app, host="127.0.0.1", port=8000)
