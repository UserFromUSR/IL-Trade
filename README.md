# 📓 IL-Trading Journal PRO+

Торговый журнал как Telegram Mini App.  
Стек: Vanilla JS + Vite · Firebase Realtime DB · MEXC WebSocket · Telegraf Bot

---

## 📁 Структура проекта

```
il-trading-journal/
├── src/
│   ├── api/
│   │   ├── mexc-ws.js       — WebSocket клиент MEXC
│   │   └── telegram.js      — Telegram WebApp SDK обёртка
│   ├── config/
│   │   └── firebase.js      — Firebase инициализация
│   ├── services/
│   │   └── calculator.js    — ⚠️ НЕ ТРОГАТЬ — математика PnL/RR
│   ├── ui/
│   │   ├── handlers.js      — Все обработчики событий
│   │   └── renderer.js      — Рендеринг UI
│   └── main.js              — Точка входа
├── bot-server/
│   ├── index.js             — Telegram Bot (Telegraf)
│   ├── package.json
│   └── .env.example         — Пример переменных окружения
├── .github/workflows/
│   └── deploy.yml           — CI/CD: auto-deploy в Firebase
├── index.html
├── vite.config.js
├── firebase.json
├── package.json
└── .gitignore
```

---

## 🚀 Инструкция для смартфона (шаг за шагом)

### ШАГ 1 — Создать репозиторий на GitHub

1. Открой браузер на телефоне → перейди на **github.com**
2. Войди в аккаунт (или создай — бесплатно)
3. Нажми зелёную кнопку **"New"** (или значок **"+"** → *New repository*)
4. Заполни:
   - **Repository name:** `il-trading-journal`
   - **Visibility:** `Private` ✅ (важно — там твои данные)
   - Поставь галочку **"Add a README file"**
5. Нажми **"Create repository"**

---

### ШАГ 2 — Загрузить файлы в репозиторий

#### Вариант А — через браузер (самый простой):

1. Открой созданный репозиторий
2. Нажми **"Add file"** → **"Upload files"**
3. Загрузи файлы **по папкам** — GitHub позволяет перетаскивать целые папки
4. После каждой загрузки нажимай **"Commit changes"**

**Порядок загрузки:**
- Сначала создай папки через **"Add file"** → **"Create new file"**  
  (напиши `src/api/.gitkeep` — GitHub создаст папку автоматически)
- Загрузи файлы в нужные папки

#### Вариант Б — через GitHub Mobile App (удобнее):

1. Установи приложение **GitHub** (iOS / Android)
2. Войди в аккаунт
3. Открой репозиторий → используй встроенный редактор файлов

#### Вариант В — через Termux (Android, продвинутый):

```bash
# Установи Termux из F-Droid
pkg install git nodejs
git clone https://github.com/ТВО_ИМЯ/il-trading-journal.git
cd il-trading-journal
# Скопируй файлы, затем:
git add .
git commit -m "Initial commit"
git push
```

---

### ШАГ 3 — Подключить Firebase

#### 3.1 Создать Firebase проект (уже создан — `il-trade`)

Если нужно создать новый:
1. Открой **console.firebase.google.com** в браузере
2. **"Add project"** → введи название → создай

#### 3.2 Включить Firebase Hosting

1. В консоли Firebase → **Hosting** → **Get started**
2. Пройди мастер настройки (просто нажимай "Next")

#### 3.3 Получить Service Account для CI/CD

1. В консоли Firebase → ⚙️ **Project settings** → **Service accounts**
2. Нажми **"Generate new private key"** → скачается JSON-файл
3. Открой GitHub → твой репозиторий → **Settings** → **Secrets and variables** → **Actions**
4. Нажми **"New repository secret"**:
   - **Name:** `FIREBASE_SERVICE_ACCOUNT_IL_TRADE`
   - **Secret:** вставь **весь** содержимый JSON-файла
5. Нажми **"Add secret"**

---

### ШАГ 4 — Создать Telegram Bot

1. Открой Telegram → найди **@BotFather**
2. Напиши `/newbot`
3. Придумай имя и username (напр. `il_trading_journal_bot`)
4. BotFather даст тебе **токен** — сохрани его

#### Настроить Mini App в боте:
1. Напиши BotFather: `/newapp`
2. Выбери своего бота
3. Вставь URL твоего Firebase Hosting: `https://il-trade.web.app`
4. Готово — теперь бот запускает Mini App!

---

### ШАГ 5 — Деплой (автоматический)

После настройки GitHub Secrets:

1. Сделай любой коммит в ветку `main`  
   (например, отредактируй README)
2. GitHub Actions автоматически:
   - Установит зависимости
   - Запустит `npm run build` (Vite минифицирует код)
   - Задеплоит в Firebase Hosting
3. Через 1-2 минуты твой Mini App доступен по URL Firebase

**Смотреть прогресс деплоя:**  
GitHub → твой репо → вкладка **"Actions"**

---

### ШАГ 6 — Запустить Bot Server

Для работы Telegram-бота нужен сервер (Node.js).  
**Бесплатные варианты:**

#### Railway (рекомендуется, бесплатный план):
1. Открой **railway.app** → войди через GitHub
2. **"New Project"** → **"Deploy from GitHub repo"**
3. Выбери `il-trading-journal`
4. В настройках: **Root Directory** → `bot-server`
5. Добавь переменные окружения:
   - `BOT_TOKEN` = токен от BotFather
   - `MINI_APP_URL` = `https://il-trade.web.app`
6. Deploy → готово!

#### Render (альтернатива):
1. **render.com** → New → Web Service
2. Подключи GitHub репо
3. **Root Directory:** `bot-server`
4. **Start Command:** `node index.js`
5. Добавь env vars: `BOT_TOKEN`, `MINI_APP_URL`

---

## ⚙️ Локальная разработка

```bash
# Фронтенд
npm install
npm run dev          # http://localhost:3000

# Бот (отдельный терминал)
cd bot-server
npm install
cp .env.example .env
# Заполни .env
node index.js
```

---

## 🔧 Важные замечания

| Файл | Статус |
|------|--------|
| `src/services/calculator.js` | ⚠️ **НЕ ИЗМЕНЯТЬ** — ядро математики |
| `src/config/firebase.js` | Обнови `firebaseConfig` если меняешь проект |
| `bot-server/.env` | **Никогда не коммить в Git!** |

---

## 🐛 Частые проблемы

**"Firebase не подключён"** — обнови страницу. Если не помогает — проверь `firebaseConfig` в `firebase.js`.

**"Auth timeout"** — медленный интернет. Через 5 секунд приложение откроется в любом случае (safety valve в `main.js`).

**Бот не отвечает** — проверь, что `BOT_TOKEN` правильный. Бот должен быть запущен 24/7 на сервере.

**CI/CD не запускается** — проверь, что secret называется точно `FIREBASE_SERVICE_ACCOUNT_IL_TRADE`.
