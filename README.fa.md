# AIDetective 🔍

**پلتفرم متن‌باز، لوکال-فرست و چندوجهی (multimodal) برای تحلیل محتوای تولیدشده با هوش مصنوعی.**

AIDetective متن، اسناد، تصویر و صوت را با یک مجموعه‌ی وزن‌دار و قابل‌توضیح از detectorهای heuristic تحلیل می‌کند. هر خروجی همراه با signalهای خام، شواهد هر سیگنال، یک likelihood score، یک confidence value سقف‌دار — و یک بیانیه‌ی صادقانه درباره‌ی محدودیت‌ها ارائه می‌شود.

> ⚠️ **اول این را بخوانید: AIDetective تحلیل احتمالاتی ارائه می‌دهد و خروجی آن مدرک قطعی نیست.** خروجی این ابزار یک «برآورد» است، نه اثبات. تشخیص محتوای تولیدشده با هوش مصنوعی همیشه ممکن است **مثبت کاذب (false positive)** و **منفی کاذب (false negative)** بدهد. در این پروژه، `uncertain` (نامطمئن) و `inconclusive` (غیرقابل‌تعیین) خروجی‌های درجه‌یک و معتبر هستند و موتور امتیازدهی **عمداً طوری طراحی شده که confidence هرگز به ۱.۰ نرسد**. از AIDetective به‌عنوان تنها مدرک برای متهم‌کردن، تنبیه، تهمت یا قضاوت درباره‌ی هیچ‌کس استفاده نکنید. جزئیات کامل در [docs/limitations.md](docs/limitations.md).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Engine](https://img.shields.io/badge/engine-0.1.0-informational)]()
[![Status](https://img.shields.io/badge/status-MVP%20%2F%20heuristic%20baselines-orange)]()

---

## فهرست

- [نماهای برنامه (Screenshots)](#نماهای-برنامه-screenshots)
- [این چیست / این چیست نیست](#این-چیست--این-چیست-نیست)
- [ویژگی‌ها](#ویژگی‌ها)
- [وجه‌ها و فرمت‌های پشتیبانی‌شده](#وجه‌ها-و-فرمت‌های-پشتیبانی‌شده)
- [معماری](#معماری)
- [Detectorهای داخلی](#detectorهای-داخلی)
- [استک فنی و تغییر طراحی](#استک-فنی-و-تغییر-طراحی)
- [نصب](#نصب)
- [بیلد production و Docker](#بیلد-production-و-docker)
- [استفاده از API](#استفاده-از-api)
- [کلاینت پایتون](#کلاینت-پایتون)
- [راه‌اندازی LLM](#راه‌اندازی-llm)
- [توسعه‌ی plugin](#توسعه‌ی-plugin)
- [توسعه‌ی detector](#توسعه‌ی-detector)
- [ساختار پروژه](#ساختار-پروژه)
- [تست](#تست)
- [محدودیت‌ها](#محدودیت‌ها)
- [نقشه‌ی راه](#نقشه‌ی-راه)
- [متغیرهای محیطی](#متغیرهای-محیطی)
- [مشارکت](#مشارکت)
- [لایسنس](#لایسنس)

---

## نماهای برنامه (Screenshots)

> تصاویر زیر از داشبورد وب محلی (نسخه 0.1.0) گرفته شده‌اند.

![Dashboard](docs/screenshots/dashboard.png)
![تحلیل متن همراه با signalها و شواهد](docs/screenshots/text-analysis.png)
![تحلیل تصویر همراه با شواهد metadata](docs/screenshots/image-analysis.png)
![نمای گزارش](docs/screenshots/report.png)

---

## این چیست / این چیست نیست

| ✅ این **هست** | ❌ این **نیست** |
| --- | --- |
| یک workbench تحلیلی، لوکال-فرست و self-hosted برای «نشانه‌های ظن به محتوای AI» | یک ابزار forensic یا تأییدکننده‌ی قطعی هویت نویسنده برای دادگاه |
| یک موتور امتیازدهی deterministic و قابل‌توضیح روی **detectorهای heuristic پایه** | یک مدل ML آموزش‌دیده (در این نسخه هیچ مدلی آموزش داده نشده — detectorها heuristicهای شفاف‌اند) |
| سیستمی که کارتش را نشان می‌دهد: هر signal، مقدار، وزن و شواهد قابل بازرسی‌اند | یک جعبه‌سیاه که فقط یک «درصد AI با قطعیت» برمی‌گرداند |
| پلتفرمی که در آن `uncertain` و `inconclusive` پاسخ‌های معتبر و مورد انتظارند | یک پیشگو. برای بخش بزرگی از محتوای واقعی، پاسخ صادقانه همان ابهام است |
| یک پلتفرم plugin (detector، parser، LLM provider، report exporter) | جایگزین سیستم‌های provenance مثل C2PA و واترمارک — آن‌ها در roadmap هستند |
| یک لایه‌ی LLM اختیاری که فقط **توضیح** می‌دهد | یک قاضی LLM — طبق قراردادِ prompt و طبق کد، LLM هرگز نمی‌تواند verdict را تغییر دهد |

**تشخیص، احتمالاتی است.** هر classification (یعنی `likely_human`، `likely_ai_generated`، `likely_synthetic`) را نقطه‌ی شروعِ بازبینی انسانی بدانید، هرگز نتیجه‌ی نهایی.

---

## ویژگی‌ها

- **چهار وجه (modality)**: متن (inline یا فایل)، اسناد (PDF/DOCX)، تصویر (PNG/JPG/WEBP)، صوت (WAV/MP3/FLAC/M4A).
- **۱۵ detector داخلی heuristic** که هر signal را با `aiScore` (۰ = کاملاً انسانی … ۱ = کاملاً AI، ۰.۵ = خنثی)، weight، direction و **شواهد** (نقل‌قول یا آمار) همراه می‌کنند.
- **موتور امتیازدهی قابل‌توضیح**: رأی وزن‌دار → likelihood score؛ هم‌سویی و شدت signalها → confidence (به‌طور پیش‌فرض با سقف سخت ۰.۹۲). سهم هر سیگنال در امتیاز نهایی به‌صورت breakdown ذخیره می‌شود.
- **pipeline تحلیل فایل** با تشخیص نوع فایل از روی magic bytes، پاک‌سازی filename، محدودیت حجم و پردازش صف‌شده (202 + polling).
- **گزارش‌ها**: JSON ساختاریافته و HTML مستقل و قابل چاپ (در این نسخه فقط JSON و HTML؛ PDF از طریق رابط `ReportExporter` در roadmap است).
- **لایه‌ی LLM اختیاری** (فقط توضیح): ZAI managed runtime، Ollama یا هر API سازگار با OpenAI (OpenAI/OpenRouter/سرویس‌های دلخواه). به‌طور پیش‌فرض غیرفعال است.
- **سیستم plugin**: یک پوشه زیر `plugins/` بگذارید؛ loader در زمان boot آن را ثبت می‌کند — plugin خراب، contained می‌شود و گزارش می‌شود، هرگز برنامه را نمی‌اندازد.
- **REST API** در مسیر `/api/v1` با envelope یکپارچه‌ی `{ok, data | error}`، CORS، سند OpenAPI 3.0.3 (۱۸ مسیر)، auth اختیاری با API key و rate limit هر کلید (کلیدها به‌صورت sha256 ذخیره می‌شوند و plaintext فقط یک‌بار نمایش داده می‌شود).
- **ذخیره‌سازی لوکال-فرست**: SQLite از طریق Prisma؛ فایل‌های آپلودی با id تولیدشده‌ی سمت سرور داخل پوشه‌ی `uploads/` نگهداری می‌شوند.
- **آگاهی از فارسی و انگلیسی** در featureهای متنی (تشخیص زبان، phrase listها؛ پوشش فارسی صریحاً experimental است).

---

## وجه‌ها و فرمت‌های پشتیبانی‌شده

تشخیص نوع فایل بر اساس **magic bytes** انجام می‌شود — نام فایل و MIME type اعلان‌شده از سمت کاربر فقط «hint» هستند.

| ورودی | تشخیص داده می‌شود به | Pipeline | سطح تحلیل |
| --- | --- | --- | --- |
| متن inline (`POST /api/v1/analyze`) | `text` | استخراج کامل featureهای متنی | **کامل** — هر ۹ detector متنی |
| `.txt` / `.md` (سینتکس Markdown تا حدی پاک می‌شود) | `text` | parser متن ساده | **کامل** — هر ۹ detector متنی |
| `.pdf` | `document` | استخراج متن با `unpdf` → pipeline متن | **کامل (در سطح متن)** — PDFهای تصویری/اسکن‌شده با هشدار صریح همراه می‌شوند؛ OCR وجود ندارد |
| `.docx` | `document` | استخراج متن با `mammoth` → pipeline متن | **کامل (در سطح متن)** |
| `.png` / `.jpg` / `.jpeg` | `image` | metadata (EXIF/چانک‌های PNG، جدول quantization فشرده‌سازی JPEG) + آمار پیکسلی پس از decode با `sharp` | **baseline احتمالاتی** — در این نسخه هیچ مدل computer-vision آموزش‌دیده‌ای وجود ندارد |
| `.webp` | `image` | آمار پیکسلی پس از decode | **محدود** — پردازش metadata برای WEBP محدود است (هشدار همراه خروجی) |
| `.wav` | `audio` | metadata کانتینر **+ آمار waveform روی PCM** | **کامل (در سطح صوت)** — تنها فرمتی است که waveform analysis دارد |
| `.mp3` / `.flac` / `.m4a` | `audio` | فقط metadata کانتینر/تگ (ID3v2، VORBIS comments، `ilst` در M4A) | **فقط metadata** — تحلیل waveform در این نسخه فقط برای WAV است |

**تحلیل گفتار به متن (ASR/transcript) هنوز وجود ندارد** (نه ASR انگلیسی و نه ASR فارسی). بخش [محدودیت‌ها](#محدودیت‌ها) و [نقشه‌ی راه](#نقشه‌ی-راه) را ببینید.

---

## معماری

```
                    ┌───────────────────────┐
                    │        User           │
                    └──────────┬────────────┘
                               │
                    ┌──────────▼────────────┐
                    │    Web Dashboard      │   (در حال توسعه — این نسخه API-first است)
                    └──────────┬────────────┘
                               │
                    ┌──────────▼────────────┐
                    │   REST API /api/v1    │   auth (API key اختیاری) · CORS · {ok,data|error}
                    └──────────┬────────────┘
                               │
                    ┌──────────▼────────────┐
                    │ Analysis Orchestrator │   مسیر inline متن · مسیر صف‌شده فایل (FIFO درون‌حافظه‌ای)
                    └──────────┬────────────┘
                               │
        ┌──────────────────────┼───────────────────────┐
        │                      │                       │
┌───────▼────────┐    ┌────────▼────────┐    ┌─────────▼────────┐
│ Text/Document  │    │  Image Pipeline │    │  Audio Pipeline  │   ← pipelineهای هر وجه
│    Pipeline    │    │  (sharp, EXIF)  │    │ (decode PCM WAV) │     (parserها به این‌ها می‌ریزند)
└───────┬────────┘    └────────┬────────┘    └─────────┬────────┘
        │                      │                       │
        └──────────────┬───────┴───────────┬───────────┘
                       │                   │
            ┌──────────▼──────────┐  ┌─────▼─────────────┐
            │      Detectors      │  │    Evidence       │   ۱۵ detector داخلی + pluginها،
            │ (signalهای heuristic)│ │ (نقل‌قول، آمار،   │  خطای هر detector ایزوله است
            └──────────┬──────────┘  │  metadata)        │
                       └──────┬──────┴───────────────────┘
                              │
                   ┌──────────▼────────────┐
                   │    Scoring Engine     │  رأی وزن‌دار → score
                   │ (deterministic)       │  هم‌سویی/شدت → confidence (سقف‌دار < ۱.۰)
                   └──────────┬────────────┘  آستانه‌ها · قواعد uncertain/inconclusive
                              │
                   ┌──────────▼────────────┐
                   │ Optional LLM (zai /   │  فقط توضیح — خروجی ساخت‌یافته را می‌گیرد
                   │ Ollama / OpenAI-comp.)│  و هرگز نمی‌تواند آن را تغییر دهد
                   └──────────┬────────────┘
                              │
                   ┌──────────▼────────────┐
                   │    Report Engine      │  JSON + HTML مستقل (exporterهای plugin)
                   └──────────┬────────────┘
                              │
                   ┌──────────▼────────────┐
                   │   Database (Prisma +  │  تحلیل‌ها، signalها، اجرای detectorها،
                   │   SQLite, لوکال-فرست)  │  گزارش‌ها، کلیدها، pluginها، رخدادها، تنظیمات
                   └───────────────────────┘
```

شرح عمیق‌تر (روند orchestrator، ریاضیات scoring، طراحی صف و مدل امنیتی) در [docs/architecture.md](docs/architecture.md) آمده است.

---

## Detectorهای داخلی

همه‌ی detectorها **heuristicهای شفاف** هستند (بدون مدل آموزش‌دیده). هر detector `limitations` صادقانه‌ی خودش را دارد — که از `GET /api/v1/detectors` هم قابل مشاهده است. وزن‌ها نسبی و درون‌وجهی‌اند و در زمان اجرا قابل تنظیم‌اند.

| شناسه‌ی Detector | وجه | چه چیزی را می‌سنجد | وزن |
| --- | --- | --- | --- |
| `text.burstiness` | متن، سند | تغییرپذیری طول جمله‌ها (ضریب تغییرات). ریتم یکنواخت به سمت AI؛ ریتم موج‌دار به سمت انسان | 0.80 |
| `text.phrases` | متن، سند | تراکم عباراتی که در خروجی LLM بیش‌ازحد دیده می‌شوند ("delve into"، "plays a crucial role"، …؛ لیست انگلیسی کامل، لیست فارسی experimental). مورد‌ها به‌صورت نقل‌قول مستند می‌شوند | 0.85 |
| `text.structure` | متن، سند | «مرتب‌بودن» ساختار: یکنواختی طول پاراگراف‌ها، حرف‌بزرگ و نقطه‌گذاری بی‌نقص در همه‌ی جمله‌ها، اسکلت فهرست‌مانند | 0.60 |
| `text.vocabulary` | متن، سند | غنای واژگانی: root TTR، سهم hapax legomena، entropy نرمال‌شده | 0.55 |
| `text.informality` | متن، سند | نشانه‌های انسانی: contractions (don't، I'm)، واژگان خودمانی (lol، btw)، ایموجی، کشیدن حروف، حروف بزرگ | 0.55 |
| `text.repetition` | متن، سند | تکرار دقیق توالی‌های ۴ کلمه‌ای (آرتیفکت‌های تولید، محتوای تکراری) | 0.50 |
| `text.punctuation` | متن، سند | عادت‌های نقطه‌گذاری: میزان ! و ?، تراکم em-dash، سه‌نقطه، نظم ویرگول‌ها | 0.50 |
| `text.connectives` | متن، سند | تراکم حروف ربط/پیوند رسمی (however، moreover، furthermore…) | 0.50 |
| `text.lexical_entropy` | متن، سند | entropy شانون روی توزیع فراوانی واژه‌ها، نرمال‌شده در [0,1] | 0.40 |
| `image.metadata` | تصویر | provenance در EXIF/PNG: تگ ابزارهای مولد AI، metadata دوربین، نرم‌افزار ویرایش، نشانگرهای C2PA | 0.90 |
| `audio.metadata` | صوت | metadata کانتینر/تگ (ID3v2، VORBIS، `ilst` در M4A، `LIST/INFO` در WAV): نرم‌افزار encoder و ابزارهای شناخته‌شده‌ی TTS | 0.90 |
| `image.dimensions` | تصویر | پروفایل ابعاد: بوم‌های رایج مدل‌های diffusion ( مضرب ۶۴) در مقابل اندازه‌های سنسور دوربین | 0.45 |
| `audio.waveform` | صوت *(فقط WAV، experimental)* | پویایی PCM: تغییرات RMS در پنجره‌های ۵۰ میلی‌ثانیه‌ای، نسبت سکوت و ساختار مکث‌ها، clipping، DC offset، نرخ عبور از صفر | 0.40 |
| `image.pixel_stats` | تصویر *(experimental)* | آمار مرتبه‌اول پیکسل‌ها: انرژی فرکانس‌بالا (واریانس لاپلاسین)، یکنواختی LSB، توازن کانال‌ها | 0.30 |
| `image.compression` | تصویر | پروفایل فشرده‌سازی: برآورد کیفیت JPEG از جدول quantization + subsampling رنگ، یا پروفایل bit-depth/رنگ PNG (بیشتر توصیفی) | 0.25 |

**plugin نمونه:** [`plugins/example-text-detector/`](plugins/example-text-detector/)detector با شناسه `text.example.hedging` (وزن 0.35) را ثبت می‌کند — یک detector واقعی و deterministic که شروع‌کننده‌های hedging/SEO را می‌شمارد ("In this article, we will…"، "Let's dive in"…) و هر مورد را به‌عنوان شاهد نقل می‌کند. این plugin هم‌زمان پیاده‌سازی مرجع قرارداد plugin است.

---

## استک فنی و تغییر طراحی

- **Next.js 16 (App Router) + TypeScript** — route handlerهای `src/app/api/v1/**` لایه‌ی REST هستند.
- **Prisma 6 + SQLite** — ذخیره‌سازی لوکال-فرست (schema از قابلیت‌های خاص SQLite پرهیز کرده تا مهاجرت بعدی به PostgreSQL ممکن باشد).
- **Tailwind CSS 4 + shadcn/ui** — زیرساخت UI (نمای‌های داشبورد در حال توسعه‌اند).
- **sharp** (آمار پیکسلی)، **exifreader** (metadata تصویر)، **unpdf** (متن PDF)، **mammoth** (متن DOCX).
- **Bun** به‌عنوان package manager و runtime؛ `z-ai-web-dev-sdk` فقط برای provider اختیاری LLM مدیریتی.

> **یادداشت صادقانه درباره‌ی تغییر طراحی:** طرح اولیه‌ی پروژه، بک‌اند **Python + FastAPI** را مشخص کرده بود. بک‌اند پیاده‌سازی‌شده **TypeScript روی Next.js 16** است. آنچه تغییر کرد: routerهای FastAPI → route handlerهای App Router؛ مدل‌های Pydantic → zod و interfaceهای TypeScript (`src/lib/aidetective/core/types.ts`)؛ صف کارگر → یک FIFO درون‌پردازشی (`src/lib/aidetective/queue/job-queue.ts`، Redis در roadmap)؛ SQLAlchemy/PostgreSQL → Prisma/SQLite برای پیش‌فرض لوکال-فرست. آنچه تغییر **نکرد**: قرارداد REST (مسیرها، envelope یکپارچه، سند OpenAPI 3.0.3، auth با کلید)، طراحی pipeline detector/analyzer/parser و رفتار deterministic و قابل‌توضیح موتور امتیازدهی. API از فریم‌ورک مستقل است — هر HTTP clientی کار می‌کند.

---

## نصب

پیش‌نیاز: **[Bun](https://bun.sh)** نسخه‌ی 1.1+ (برای serve، Node 20+ هم کار می‌کند، ولی اسکریپت‌ها Bun را فرض می‌کنند)، حدود ۵۰۰ مگابایت فضا.

```bash
git clone https://github.com/<org>/aidetective.git
cd aidetective
bun install
cp .env.example .env       # پیش‌فرض‌ها امن‌اند: LLM غیرفعال، حالت local
bun run db:push            # ساخت schema روی SQLite
bun run dev                # http://localhost:3000
```

`http://localhost:3000` را باز کنید. در این نسخه از REST API (بخش بعد) یا سند OpenAPI در `http://localhost:3000/api/v1/openapi` استفاده کنید. با اولین درخواست، موتور خودش را bootstrap می‌کند: detectorها/parserها/exporterهای داخلی → pluginها → صف کار → seed کردن model registry.

اسکریپت‌های مفید: `bun run lint`، `bun run db:generate`، `bun run db:push`، `bun run build`، `bun run start`.

---

## بیلد production و Docker

**بیلد production روی سیستم خودتان** (برای بیلد به devDependencies نیاز است):

```bash
bun install
bun run build
bun run start
```

> توجه: در این نسخه `next.config.ts` گزینه‌ی `output: "standalone"` را فعال **نکرده**، پس با `bunx next start` سرو کنید (اسکریپت `bun run start` داخل مخزن، بیلد standalone را فرض می‌کند). ایمیج Docker پایین همین را درست انجام می‌دهد.

**Docker** (توصیه‌شده):

```bash
cp .env.example .env
# در .env مقدار: DATABASE_URL=file:/app/db/custom.db را بگذارید
# (تا فایل SQLite داخل volume سوارشده‌ی ./db نوشته شود)
docker compose up -d --build
# → http://localhost:3000
```

ایمیج یک build سه‌مرحله‌ای روی `oven/bun:1` است (deps → build → runtime). در شروع کانتینر، ابتدا `bun run db:push` (همگام‌سازی idempotent اسکیما) و سپس `bunx next start -p 3000` اجرا می‌شود. دایرکتوری‌های `./db` و `./uploads` را mount کنید (docker-compose.yml همین کار را می‌کند) تا فایل SQLite و فایل‌های آپلودی با جابه‌جایی کانتینر از بین نروند.

---

## استفاده از API

Base URL: `http://localhost:3000`. همه‌ی پاسخ‌ها با envelope یعنی `{"ok": true, "data": …}` یا `{"ok": false, "error": {"code", "message", "details?"}}` برمی‌گردند. CORS فعال است؛ auth در حالت local اختیاری است (بخش [کلیدهای API](#کلیدهای-api) را ببینید).

**OpenAPI:** `GET /api/v1/openapi` سند کامل **OpenAPI 3.0.3** (۱۸ مسیر) را برمی‌گرداند. همین URL را مستقیم در Swagger UI، Postman، Insomnia یا Redoc ایمپورت کنید.

### تحلیل متن inline

```bash
curl -s http://localhost:3000/api/v1/analyze \
  -H "Content-Type: application/json" \
  -d '{
        "content": "In today'"'"'s fast-paced world, it is important to delve into the crucial role of technology. Furthermore, it is worth noting that…",
        "options": { "useLlm": false }
      }'
# → data.classification، data.likelihoodScore، data.confidence، data.signals[]، data.detectorRuns[]
```

### تحلیل فایل آپلودی (multipart → 202 → polling)

```bash
curl -s -X POST http://localhost:3000/api/v1/analyze/file \
  -F "file=@./sample.pdf" \
  -F 'options={"useLlm":true}'
# → 202 Accepted همراه با یک analysis صف‌شده؛ سپس polling:
curl -s http://localhost:3000/api/v1/analyses/<id>      # تا status: completed | failed
```

### فهرست و جستجوی تحلیل‌ها

```bash
curl -s "http://localhost:3000/api/v1/analyses?modality=image&status=completed&sort=createdAt&order=desc&page=1&pageSize=20"
```

پارامترهای query: `query, modality, classification, status, from, to, sort (createdAt|likelihoodScore|confidence|processingTime), order, page, pageSize (حداکثر 100)`.

### دریافت گزارش (JSON یا HTML)

```bash
curl -s "http://localhost:3000/api/v1/reports/<id>?format=json" | jq
curl -s "http://localhost:3000/api/v1/reports/<id>?format=html" -o report.html   # مستقل و قابل چاپ
```

هر دو گزارش، اطلاعات نسخه‌ی نرم‌افزار و بیانیه‌ی صریح «این خروجی اثبات نیست» را داخل خودشان دارند. گزارش فقط برای تحلیل‌های `completed` تولید می‌شود (در غیر این صورت 409). در این نسخه فقط JSON و HTML (خروجی PDF در roadmap و به‌صورت exporter افزودنی است).

### کلیدهای API

Auth به‌طور پیش‌فرض **حالت local اختیاری** است (`AIDETECTIVE_REQUIRE_API_KEY=false`): درخواست‌های بدون کلید از کلاینت‌های local پذیرفته می‌شوند؛ اگر کلید هم ارسال شود اعتبارسنجی می‌شود. برای استقرار مشترک/راه‌ دور، الزام کلید را فعال کنید.

```bash
# ساخت کلید (plaintext فقط یک‌بار نمایش داده می‌شود — فقط sha256 آن ذخیره می‌شود)
curl -s -X POST http://localhost:3000/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-client", "rateLimit": 60}'
# → {"ok":true,"data":{"key":"adk_5f3c…","prefix":"adk_5f3c…","…"}}

# استفاده (Bearer یا X-API-Key)
curl -s http://localhost:3000/api/v1/analyses \
  -H "Authorization: Bearer adk_5f3c…"

# ابطال بعدی
curl -s -X DELETE http://localhost:3000/api/v1/api-keys/<keyId>
```

### بقیه‌ی endpointها

`GET /system/status` · `GET /stats` · `GET /detectors` · `GET|POST /models`، `PATCH|DELETE /models/{id}` · `GET /plugins` · `GET|POST /datasets`، `GET|DELETE /datasets/{id}`، `POST /datasets/{id}/samples` (فقط ایمپورت متنی) · `POST /llm/test` · `GET|PUT /settings` · `DELETE /analyses/{id}`. جزئیات کامل: [`/api/v1/openapi`](http://localhost:3000/api/v1/openapi).

---

## کلاینت پایتون

یک کلاینت نمونه با تنها وابستگیِ `requests` در **[`examples/aidetective_client.py`](examples/aidetective_client.py)** قرار دارد. این اسکریپت متن یا فایل را تحلیل می‌کند، برای تحلیل‌های صف‌شده polling می‌زند و classification، likelihood score، confidence و signalهای برتر را چاپ می‌کند — همیشه همراه یادآوریِ «این خروجی اثبات نیست».

```bash
pip install requests
export AIDETECTIVE_URL=http://localhost:3000
export AIDETECTIVE_API_KEY=adk_...        # اختیاری (فقط وقتی الزام کلید فعال است)

python examples/aidetective_client.py text "In today's fast-paced world, it is crucial to note that…"
python examples/aidetective_client.py file ./sample.pdf
```

---

## راه‌اندازی LLM

لایه‌ی LLM **اختیاری و فقط برای توضیح** است. verdict و score و confidence فقط و فقط از موتور امتیازدهی deterministic می‌آیند. interpreter فقط خروجی ساخت‌یافته (classification، score، confidence، حداکثر ۲۰ signal فشرده و نقل‌قول‌های شواهد کلیدی) را می‌گیرد و prompt سیستمیِ آن تغییر، بازمحاسبه یا تأییدِ verdict را ممنوع می‌کند. اگر فراخوانی LLM شکست بخورد، تحلیل عادی کامل می‌شود و فقط یک warning اضافه می‌شود. پیکربندی از طریق متغیرهای محیطی **و/یا** تنظیمات زمان اجرا (`GET/PUT /api/v1/settings`؛ صفحه‌های LLM و Settings در داشبورد همین کنترل‌ها را دارند) انجام می‌شود. توضیح LLM فقط وقتی تولید می‌شود که LLM فعال باشد **و** `options.useLlm: true` ارسال شود. `POST /api/v1/llm/test` اتصال را تست می‌کند.

| Provider | `AIDETECTIVE_LLM_PROVIDER` | متغیرهای لازم | توضیح |
| --- | --- | --- | --- |
| **ZAI managed runtime** | `zai` | هیچ | بدون کلید سمت کاربر کار می‌کند (برای محیط‌های مدیریتی)؛ مدل `glm-4.5-flash` |
| **Ollama (محلی)** | `ollama` | `AIDETECTIVE_LLM_BASE_URL` (مثلاً `http://localhost:11434`) | مدل پیش‌فرض `llama3.1` (با `AIDETECTIVE_LLM_MODEL` عوض کنید)؛ کاملاً آفلاین |
| **سازگار با OpenAI** | `openai_compatible` | `AIDETECTIVE_LLM_BASE_URL` (مثلاً `https://api.openai.com/v1` یا `https://openrouter.ai/api/v1`) | `AIDETECTIVE_LLM_API_KEY` اختیاری (Bearer)؛ مدل پیش‌فرض `gpt-4o-mini` |

```bash
# مثال: Ollama محلی
AIDETECTIVE_LLM_ENABLED=true
AIDETECTIVE_LLM_PROVIDER=ollama
AIDETECTIVE_LLM_BASE_URL=http://localhost:11434
AIDETECTIVE_LLM_MODEL=llama3.1

# مثال: OpenRouter
AIDETECTIVE_LLM_ENABLED=true
AIDETECTIVE_LLM_PROVIDER=openai_compatible
AIDETECTIVE_LLM_BASE_URL=https://openrouter.ai/api/v1
AIDETECTIVE_LLM_MODEL=meta-llama/llama-3.1-8b-instruct
AIDETECTIVE_LLM_API_KEY=sk-or-...

# تست:
curl -s -X POST http://localhost:3000/api/v1/llm/test
```

توضیح LLM روی خود analysis ذخیره می‌شود (`llmInterpretation`، `llmProvider`، `llmModel`) و در گزارش‌ها می‌آید — همیشه به‌شکل جدا از signalهای موتور و با برچسب صریح.

---

## توسعه‌ی plugin

راهنمای کامل همراه با کد قابل‌اجرا: **[docs/plugins.md](docs/plugins.md)**. خلاصه‌ی قرارداد:

```
plugins/<my-plugin>/
├── plugin.json   # manifest: { id, name, version, type, modality?, entry, description? }
└── index.js      # ESM؛ باید register(api) را export کند
```

`type` یکی از `detector | parser | llm_provider | exporter`. loader در زمان boot پوشه‌ی `plugins/` را اسکن می‌کند (ریشه‌ی ثابت، بدون path traversal)، manifestها را اعتبارسنجی می‌کند، فایل ورودی را در زمان اجرا dynamic-import می‌کند (هرگز bundle یا `eval` نمی‌شود) و `register(api)` را با این متدها صدا می‌زند:

```js
api.registerDetector(detector)      // آبجکت Detector (بخش بعد)
api.registerParser(parser)          // FileParser — فرمت‌های ورودی جدید
api.registerLLMProvider(provider)   // فقط برای نمایش ثبت می‌شود؛ provider فعال از تنظیمات خوانده می‌شود (هیچ pluginی نمی‌تواند ترافیک LLM را بدزدد)
api.registerExporter(exporter)      // ReportExporter — مثلاً exporter PDF در آینده
```

هر ثبت اعتبارسنجی می‌شود؛ pluginی که خطا بدهد با status `error` ثبت می‌شود (در `GET /api/v1/plugins` و دیتابیس دیده می‌شود) و **نمی‌تواند برنامه را از کار بیندازد**. برای reload کافی است برنامه را ری‌استارت کنید. نقطه‌ی شروع: [`plugins/example-text-detector/`](plugins/example-text-detector/).

---

## توسعه‌ی detector

یک detector یک آبجکت ساده است که interface یعنی `Detector` را از [`src/lib/aidetective/core/types.ts`](src/lib/aidetective/core/types.ts) پیاده می‌کند:

```ts
interface Detector {
  id: string;                    // مثلاً "text.my-detector" (با namespace هر وجه)
  name: string;
  version: string;               // با تغییر رفتار بump کنید — در هر اجرا ذخیره می‌شود
  description: string;
  modalities: Modality[];        // "text" | "image" | "audio" | "document"
  defaultWeight: number;         // 0..1، اهمیت نسبی درون وجه
  limitations: string[];         // صادقانه و قابل‌مشاهده برای کاربر — اجباری
  analyze(ctx: DetectorContext): Promise<{
    status: "ok" | "skipped" | "error";
    signals: Signal[];
    summary?: string;
    error?: string;
  }>;
}

interface Signal {
  id: string;                    // مثلاً `${detectorId}.low_variance`
  detectorId: string;
  name: string;
  value?: number | string | boolean | null;
  unit?: string;
  aiScore: number | null;        // 0 = کاملاً انسانی، 0.5 = خنثی، 1 = کاملاً AI؛ null = غیرقابل‌کمّی‌سازی
  weight: number;
  evidence: EvidenceItem[];      // نقل‌قول / آمار / metadata / مشاهده
  notes?: string;
}
```

`ctx` شامل `input` (متن یا buffer + metadata)، `modality`، featureهای از پیش استخراج‌شده (`features`) و `options` است. قواعد ما:

- **همیشه `limitations` را پر کنید** — detectorی که ضعف‌هایش را پنهان کند در review پذیرفته نمی‌شود.
- وقتی ورودی برای اندازه‌گیری کافی نیست (مثلاً جمله‌های خیلی کم)، `status: "skipped"` برگردانید؛ برای یافته‌های توصیفی اما غیرقابل‌کمّی‌سازی، `aiScore: null` برگردانید.
- خطای پرتاب‌شده هرگز تحلیل را متوقف نمی‌کند — به‌صورت per-detector ثبت و به‌عنوان warning نمایش داده می‌شود.
- موتور امتیازدهی وزن‌ها را به بازه‌ی [0, 1] می‌clamp می‌کند و کاربر می‌تواند وزن هر detector id را از تنظیمات override کند.

---

## ساختار پروژه

```
├── prisma/
│   └── schema.prisma                 # Analysis, AnalysisSignal, AnalysisDetectorRun, Report,
│                                     # ApiKey, Dataset, Model, Plugin, SystemEvent, Setting
├── plugins/
│   └── example-text-detector/        # plugin مرجع (plugin.json + index.js)
├── docs/
│   ├── architecture.md               # شرح عمیق: orchestrator، ریاضیات scoring، صف، امنیت
│   ├── plugins.md                    # راهنمای نویسندگان plugin + مثال‌های کامل
│   └── limitations.md                # محدودیت‌های صادقانه و راهنمای استفاده‌ی مسئولانه
├── examples/
│   └── aidetective_client.py         # کلاینت REST پایتون (فقط requests)
├── src/
│   ├── app/
│   │   ├── page.tsx                  # ریشه‌ی وب (داشبورد در حال توسعه)
│   │   └── api/v1/                   # REST API (۱۸ مسیر، OpenAPI 3.0.3)
│   │       ├── analyze/              # POST متن inline
│   │       ├── analyze/file/         # POST multipart (202 + polling)
│   │       ├── analyses/             # GET فهرست/جستجو · GET|DELETE /analyses/[id]
│   │       ├── reports/[id]/         # GET ?format=json|html
│   │       ├── system/status/ · stats/ · detectors/
│   │       ├── models/ · models/[id]/ · plugins/ · datasets/… · llm/test/
│   │       ├── settings/ · api-keys/ · api-keys/[id]/
│   │       └── openapi/              # سند OpenAPI 3.0.3
│   ├── components/
│   │   ├── aidetective/views/        # نمای‌های داشبورد (در حال توسعه)
│   │   └── ui/                       # کامپوننت‌های shadcn/ui
│   ├── lib/
│   │   ├── api/respond.ts            # envelope {ok, data|error}، CORS، wrapper احراز هویت
│   │   ├── db.ts                     # کلاینت Prisma
│   │   └── aidetective/
│   │       ├── core/                 # types، scoring، registry، config، logger، errors
│   │       ├── features/             # استخراج‌کننده‌های feature متن / تصویر / صوت
│   │       ├── parsers/              # txt·md، pdf، docx، عبور تصویر، عبور صوت
│   │       ├── detectors/
│   │       │   ├── text/             # ۹ detector
│   │       │   ├── image/            # ۴ detector
│   │       │   ├── audio/            # ۲ detector
│   │       │   └── register.ts
│   │       ├── analyzers/            # pipeline هر وجه
│   │       ├── orchestrator.ts       # تحلیل inline + صف‌شده
│   │       ├── llm/                  # providerها (zai، ollama، سازگار با OpenAI) + interpreter
│   │       ├── reports/              # exporterهای JSON + HTML
│   │       ├── plugins/              # loader (اسکن fs + dynamic import در زمان اجرا)
│   │       ├── services/             # analysis-store، settings، system
│   │       ├── queue/                # صف FIFO درون‌حافظه‌ای (Redis در roadmap)
│   │       ├── security/             # اعتبارسنجی فایل با magic bytes، auth با API key
│   │       └── bootstrap.ts          # داخلی‌ها → pluginها → صف → seed مدل‌ها
│   └── hooks/                        # ابزارهای UI
├── Dockerfile · docker-compose.yml · .dockerignore
├── .env.example · LICENSE (MIT) · README.md · README.fa.md
└── worklog.md                        # دفتر کار agents
```

---

## تست

پروژه یک suite تست خودکارِ واقعی دارد (`bun test`، **۱۸۶ تست / ۸۶۹ assertion** در ۱۲ فایل) — بدون mock از منطق موتور، بدون نتیجه‌ی جعلی:

- **تست‌های unit** (`tests/unit/`): ریاضیات Scoring Engine (رأی وزن‌دار، polarity، consistency، سقف confidence، قواعد uncertain/inconclusive، override وزن‌ها)؛ آمارهای feature متنی؛ **هر ۱۵ detector با تضمین determinism** (ورودی یکسان → خروجی JSON-یکسان) و بررسی جهتِ صادقانه‌ی signalها؛ pipeline تصویر (بافرهای واقعی PNG/JPEG ساخت‌شده در تست: پارس IHDR/tEXt، معکوس‌سازی کیفیت DQT، طبقه‌بندی chroma subsampling طبق JFIF، آمار پیکسلی sharp)؛ pipeline صوت (بافرهای واقعی WAV/MP3/FLAC/M4A: دیکود PCM با مقادیر RMS/peak معلوم، پارس ID3v2 و تشخیص TTS، FLAC STREAMINFO)؛ امنیت فایل (تشخیص magic bytes در برابر extension دروغگو، پاک‌سازی filename، محدودیت حجم، محصور بودن مسیر ذخیره‌سازی)؛ parserها (TXT/MD/PDF/DOCX با فایل‌های واقعی)؛ صف کارها (FIFO، هم‌روندی، containment کرش)؛ رجیستری و بارگذاری plugin (plugin نمونه‌ی همراه از دیسک بارگذاری می‌شود)؛ gating لایه‌ی LLM (فقط-توضیح، بی‌نیاز از vendor)؛ exporterهای گزارش (ساختار JSON + escape شدن HTML).
- **تست‌های integration** (`tests/integration/`): اجرا روی **سرور زنده** — تمام endpointهای `/api/v1/`، جریان کامل `upload → queue → analysis → database → report` برای PNG/TXT/DOCX/PDF/WAV/MP3، پاکت خطاهای ساخت‌یافته (400/404/409/413/415/429)، preflight رمز عبور CORS، جستجو/فیلتر/مرتب‌سازی/صفحه‌بندی history، CRUD دیتاست‌ها و مدل‌ها، چرخه‌ی حیات کلید API (ساخت → استفاده → ابطال → 401) و rate limit هر کلید، و **determinism** سرتاسری (یک متن دو بار → verdict و score و مجموعه signal یکسان).

اجرا:

```bash
bun test          # همه‌چیز (integration بدون سرور با اطلاع skip می‌شود)
bun test tests/unit/         # فقط موتور، بدون نیاز به سرور
bun run lint && bun run build  # دروازه‌های کیفیت
```

suite integration ردیف‌های واقعی (analysis/dataset/key) در دیتابیس می‌نویسد و بعد از خودش پاک می‌کند؛ کلیدهایی که می‌سازد ابطال می‌شوند و به‌عنوان تاریخچه‌ی audit در داشبورد دیده می‌شوند.

---

## محدودیت‌ها

فهرست کامل و نگه‌داری‌شده: **[docs/limitations.md](docs/limitations.md)**. خلاصه (همه‌ی این موارد به‌صورت warning توسط API/UI هم نمایش داده می‌شوند):

- **هیچ مدل ML آموزش‌دیده‌ای وجود ندارد.** هر ۱۵ detector، baseline احتمالاتی‌اند. دقت با benchmark مشخص نشده؛ فرض نکنید اعداد AUC منتشرشده‌ی جاهای دیگر اینجا معتبرند.
- **تشخیص احتمالاتی و دوطرفه است**: هم مثبت کاذب (کار انسانی که AI تشخیص داده می‌شود) و هم منفی کاذب (کار AI که انسانی تشخیص داده می‌شود) رخ می‌دهند. متن‌های کوتاه (زیر ~۱۲۰ کلمه) صریحاً «غیرقابل‌اتکا» علامت می‌خورند.
- **صوت**: تحلیل waveform فقط برای **WAV** است؛ MP3/FLAC/M4A فقط metadata؛ **بدون تحلیل ASR/transcript**، بدون ASR فارسی.
- **تصویر**: بدون مدل computer-vision آموزش‌دیده؛ پردازش metadata برای WEBP محدود؛ بدون تشخیص GPU.
- **Datasetها**: ایمپورت/اکسپورت فقط متنی (هنوز dataset تصویری/صوتی نیست)؛ هنوز evaluation harness وجود ندارد.
- **گزارش‌ها**: فقط JSON و HTML مستقل (هنوز exporter PDF نیست).
- **صف**: FIFO درون‌حافظه‌ای — بدون persistence بین ری‌استارت‌ها، بدون worker توزیع‌شده.
- **لایه‌ی LLM** اختیاری و فقط برای توضیح است؛ هرگز (و از نظر کد، هیچ‌وقت) verdict را تعیین نمی‌کند.
- **Auth** به‌طور پیش‌فرض حالت local اختیاری است — برای هر استقرار مشترک `AIDETECTIVE_REQUIRE_API_KEY` را فعال کنید.
- **suite تست خودکار** در این نسخه وجود ندارد (بخش [تست](#تست)).
- **داشبورد وب** در حال توسعه‌ی فعال است؛ این نسخه API-first است.

> ⚠️ **استفاده‌ی مسئولانه:** AIDetective تحلیل احتمالاتی ارائه می‌دهد و خروجی آن **مدرک قطعی نیست**. از آن برای اتهام حقوقی، اقدام انضباطی، تهمت یا آزار استفاده نکنید. انسان‌ها به‌طور منظم اشتباهی AI تشخیص داده می‌شوند؛ خروجی را یکی از چند ورودیِ قضاوت انسانی بدانید، نه جایگزین آن.

---

## نقشه‌ی راه

**فاز ۲ — صحت و مقیاس**

- suite تست خودکار مطابق ماتریس بالا (vitest/bun test + fixtureها).
- مدل‌های آموزش‌دیده‌ی computer-vision و صوت، توزیع‌شده **از طریق همان plugin registry موجود** (یک مدل چیزی جز detector plugin با وزن بالاتر و نتایج ارزیابی مستند نیست).
- صف مبتنی بر Redis با jobs پایدار و workerهای افقی.
- پشتیبانی PostgreSQL (schema همین حالا قابل‌حمل است).
- evaluation harness برای datasetها: اجرای مجموعه detectorها روی داده‌های برچسب‌دار و انتشار صادقانه‌ی ROC/precision-recall هر detector.
- pipeline transcript با ASR (شامل ASR فارسی) که تغذیه‌کننده‌ی detectorهای متنی باشد.

**فاز ۳ — پلتفرم**

- exporter گزارش PDF (drop-in از طریق `ReportExporter`).
- یکپارچه‌سازی راستی‌آزمایی C2PA content credentials.
- تکمیل داشبورد وب (نمای تحلیل‌ها، گزارش‌ها، تنظیمات، مدیریت pluginها).
- تنظیم خودکار وزن‌ها از datasetهای ارزیابی‌شده؛ بسته‌های detector per-locale.
- workspaceهای چندکاربره + SSO (الان عمداً single-tenant و لوکال-فرست است).

---

## متغیرهای محیطی

همه‌ی متغیرها هنگام boot در [`src/lib/aidetective/core/config.ts`](src/lib/aidetective/core/config.ts) خوانده می‌شوند. قالب کامنت‌دار در [`.env.example`](.env.example).

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `DATABASE_URL` | `file:./db/custom.db` | اتصال SQLite (لوکال-فرست). مسیرهای نسبی نسبت به `prisma/schema.prisma` حل می‌شوند؛ در Docker مسیر مطلق بدهید (`file:/app/db/custom.db`) |
| `AIDETECTIVE_REQUIRE_API_KEY` | `false` | الزام API key روی `/api/v1` (حالت local داشبورد بدون کلید کار می‌کند) |
| `AIDETECTIVE_MAX_UPLOAD_MB` | `25` | محدودیت حجم آپلود به MB (سقف سخت HTTP: ۶۰ MB) |
| `AIDETECTIVE_MAX_TEXT_CHARS` | `200000` | محدودیت طول متن inline |
| `AIDETECTIVE_LLM_ENABLED` | `false` | فعال‌سازی لایه‌ی اختیاری LLM (فقط توضیح) |
| `AIDETECTIVE_LLM_PROVIDER` | `zai` | `zai` \| `ollama` \| `openai_compatible` |
| `AIDETECTIVE_LLM_BASE_URL` | — | برای `ollama` / `openai_compatible` الزامی است |
| `AIDETECTIVE_LLM_MODEL` | پیش‌فرض provider | مثلاً `llama3.1`، `gpt-4o-mini` |
| `AIDETECTIVE_LLM_API_KEY` | — | کلید Bearer برای `openai_compatible` |
| `AIDETECTIVE_LLM_TEMPERATURE` | `0.2` | دمای تولید |
| `AIDETECTIVE_LLM_TIMEOUT_MS` | `25000` | timeout فراخوانی LLM |
| `AIDETECTIVE_QUEUE_CONCURRENCY` | `1` | تعداد workerهای صف درون‌حافظه‌ای |
| `AIDETECTIVE_UPLOADS_DIR` | `uploads` | پوشه‌ی ذخیره‌ی آپلودها (نام فایل‌ها سمت سرور تولید می‌شود) |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` (ساخت‌یافته و redact شده) |
| `AIDETECTIVE_DEBUG_CONTENT` | `false` | ثبت محتوای خام کاربر — فقط برای debug، هرگز در production |
| `AIDETECTIVE_SCORING_AI_THRESHOLD` | `0.62` | score ≥ آستانه → `likely_ai_generated` / `likely_synthetic` |
| `AIDETECTIVE_SCORING_HUMAN_THRESHOLD` | `0.42` | score ≤ آستانه → `likely_human` |
| `AIDETECTIVE_SCORING_MIN_SIGNALS` | `2` | سیگنال قابل‌استفاده‌ی کمتر از این → `uncertain` |
| `AIDETECTIVE_SCORING_MAX_CONFIDENCE` | `0.92` | سقف سخت confidence (عمداً همیشه < ۱.۰) |

---

## مشارکت

مشارکت‌ها خوش‌آمدند — به‌ویژه **detectorهای جدید** (با `limitations` صادقانه)، parserها، exporterها و datasetهای ارزیابی.

1. ابتدا [docs/architecture.md](docs/architecture.md) و [docs/plugins.md](docs/plugins.md) را بخوانید.
2. PRهای کوچک بهتر از PRهای بزرگ‌اند؛ قرارداد detector (`core/types.ts`) را stable نگه دارید.
3. هر detector باید محدودیت‌ها و حالت‌های شکست خود را مستند کند — بدون استثنا.
4. قطعیت جعل نکنید: رفتار `uncertain`/`inconclusive` و سقف confidence را دست‌نخورده نگه دارید.
5. برای refactorهای بزرگ اول issue باز کنید. پیش از ارسال `bun run lint` را اجرا کنید.

---

## لایسنس

[MIT](LICENSE) © AIDetective contributors.

---

> **یادآوری پایانی:** AIDetective تحلیل احتمالاتی ارائه می‌دهد و خروجی آن **مدرک قطعی نیست**. مثبت کاذب و منفی کاذب بخشی از طبیعت این ابزار است. از آن برای آگاه‌کردن قضاوت انسانی استفاده کنید — هرگز برای جایگزینی آن.
