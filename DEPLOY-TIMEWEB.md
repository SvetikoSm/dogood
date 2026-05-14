# Деплой на VPS (Timeweb) — шпаргалка DOGOOD

Кратко: код живёт в **GitHub**, на сервере в **`/opt/dogood`**, приложение крутится в **Docker**, снаружи обычно стоит **Nginx** на `443` → прокси на `127.0.0.1:3000`.

- Репозиторий: `https://github.com/SvetikoSm/dogood` (ветка `main`).
- Секреты продакшена: файл **`/opt/dogood/.env.production`** на сервере (в Git не коммитить).

---

## 1. Локально (Windows, PowerShell)

Путь к проекту у себя подставьте свой:

```powershell
cd "c:\Users\sveta\OneDrive\Документы\side hustling machiiine\pet store\dogood-v2"
git status
git add -A
git commit -m "Описание изменений"
git push origin main
```

Если `git commit` пишет `nothing to commit` — делайте только `git push origin main`.

---

## 2. Зайти на сервер по SSH

IP возьмите в панели Timeweb (карточка VPS → IP):

```powershell
ssh root@ВАШ_IP_VPS
```

---

## 3. На сервере: подтянуть код и пересобрать контейнер

Выполняйте **по очереди** (можно блоком, но без вставки логов из чата в терминал):

```bash
cd /opt/dogood
git pull origin main
docker build -t dogood-v2 .
docker stop dogood 2>/dev/null; docker rm dogood 2>/dev/null
docker run -d \
  --name dogood \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --env-file .env.production \
  -v dogood_data:/app/data \
  dogood-v2
```

Проверка:

```bash
docker ps --filter name=dogood
curl -sI http://127.0.0.1:3000 | head -n 5
```

Логи при сбое:

```bash
docker logs dogood --tail 80
```

---

## 4. Docker Hub (если сборка ругается на rate limit)

Один раз на сервере:

```bash
docker login
```

---

## 5. Nginx и HTTPS

Пример конфига в репозитории: `deploy/nginx-dogood.conf.example`.  
Сертификаты обычно через `certbot --nginx -d ваш-домен.ru`.

### Заказ с фото (`POST /api/order`)

У Nginx по умолчанию лимит тела запроса часто **1 МБ**. Заявка с несколькими сжатыми фото может **обрезаться** (клиент видит ошибку или «файлы не дошли» до Google).

В блоке `server { ... }` (или в `location`, где `proxy_pass` на приложение) добавьте:

```nginx
client_max_body_size 25m;
```

Проверка и перезагрузка:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Частые ошибки

| Симптом | Что сделать |
|--------|-------------|
| `Conflict` / имя контейнера занято | `docker stop dogood && docker rm dogood`, затем снова `docker run` |
| `Already up to date`, но сайт старый | Убедиться, что `git push` с ПК прошёл; на сервере `git log -1` |
| Куча `command not found` после команд | В терминал попали **строки из лога** — не вставлять лог целиком, только команды |
| Нет `Dockerfile` после `git clone` | В `main` должен быть деплой-коммит; на ПК `git push` |

---

*Обновляйте этот файл, если смените IP, путь каталога или способ деплоя.*
