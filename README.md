# Stockly Internal Web Service Deployment Guide

이 문서는 팀원이 새 Ubuntu Server VM을 올린 뒤 GitHub에서 이 프로젝트를 `git clone`하여 Internal Server Zone 안에서 `WAS01`과 `DB01` 구성을 재현하기 위한 가이드입니다.

대상 프로젝트는 `Next.js 15`, `React 19`, `Prisma`, `MongoDB` 기반의 재고 관리 웹서비스입니다. React, Next.js, Prisma 같은 Node 패키지는 직접 하나씩 설치하지 않고, 프로젝트 루트에서 `npm install`을 실행하면 `package-lock.json`에 기록된 버전으로 설치됩니다.

## 0. 목표 아키텍처

```text
pfSense
├─ DMZ
│  └─ WEB01 / Nginx Reverse Proxy
├─ Internal Server Zone
│  ├─ Windows Server VM
│  │  ├─ DC01
│  │  ├─ DNS
│  │  ├─ GPO
│  │  └─ FS01
│  └─ Ubuntu Server VM
│     ├─ WAS01 / Next.js app
│     └─ DB01 / MongoDB
├─ User PC Zone
│  ├─ PC-USER01
│  └─ PC-USER02 optional
└─ SOC/SIEM Zone
   └─ SIEM 또는 LOG01
```

권장 통신 흐름:

```text
User PC Zone
  -> pfSense
  -> DMZ WEB01:80 또는 443
  -> Internal Server Zone WAS01:3000
  -> Internal Server Zone DB01:27017
```

직접 허용할 최소 포트:

| From | To | Port | Purpose |
| --- | --- | --- | --- |
| Admin PC 또는 관리망 | WAS01 | 22/tcp | SSH 관리 |
| Admin PC 또는 관리망 | DB01 | 22/tcp | SSH 관리 |
| WEB01 | WAS01 | 3000/tcp | Reverse proxy to Next.js |
| WAS01 | DB01 | 27017/tcp | MongoDB connection |
| User PC Zone | WEB01 | 80/tcp, 443/tcp | 웹 접속 |
| WAS01, DB01 | LOG01/SIEM | 팀 정책 포트 | 로그 전송 |

차단 권장:

```text
User PC Zone -> DB01:27017 직접 접근 차단
DMZ WEB01 -> DB01:27017 직접 접근 차단
WAN -> WAS01, DB01 직접 접근 차단
```

## 1. 서버 정보 먼저 정하기

아래 값은 팀 환경에 맞게 정하고 문서 또는 작업 노트에 남겨둡니다.

| Item | Example | Team value |
| --- | --- | --- |
| WAS01 hostname | `was01` |  |
| DB01 hostname | `db01` |  |
| WEB01 hostname | `web01` |  |
| WAS01 internal IP | `10.10.20.21` |  |
| DB01 internal IP | `10.10.20.22` |  |
| WEB01 DMZ IP | `10.10.10.10` |  |
| Service domain | `stockly.internal` |  |
| App database | `stockly_internal` |  |
| App DB user | `stockly_app` |  |

이 문서의 `<WAS01_IP>`, `<DB01_IP>`, `<WEB01_IP>`, `<DOMAIN>`은 실제 값으로 바꿔서 실행합니다.

## 2. Ubuntu 공통 준비

WAS01과 DB01 모두에서 실행합니다.

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl ca-certificates gnupg git vim ufw
```

시간 동기화 확인:

```bash
timedatectl
```

필요하면 시간대를 한국 시간으로 변경합니다.

```bash
sudo timedatectl set-timezone Asia/Seoul
```

호스트명을 설정합니다.

WAS01:

```bash
sudo hostnamectl set-hostname was01
```

DB01:

```bash
sudo hostnamectl set-hostname db01
```

관리 편의를 위해 `/etc/hosts`에 내부 IP를 등록할 수 있습니다.

```bash
sudo vim /etc/hosts
```

예시:

```text
10.10.20.21 was01
10.10.20.22 db01
10.10.10.10 web01
```

## 3. DB01 - MongoDB 설치

DB01에서만 실행합니다.

이 가이드는 Ubuntu 24.04 LTS 기준으로 MongoDB Community 8.0 공식 APT 저장소를 사용합니다. Ubuntu 버전이 다르면 MongoDB 공식 문서에서 해당 Ubuntu 코드네임에 맞는 저장소를 확인해야 합니다.

Ubuntu 버전 확인:

```bash
lsb_release -a
```

MongoDB GPG key 등록:

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg \
  --dearmor
```

Ubuntu 24.04 Noble 저장소 등록:

```bash
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
```

설치:

```bash
sudo apt-get update
sudo apt-get install -y mongodb-org
```

서비스 시작 및 자동 시작 등록:

```bash
sudo systemctl enable --now mongod
sudo systemctl status mongod
```

정상 확인:

```bash
mongosh --eval 'db.runCommand({ ping: 1 })'
```

## 4. DB01 - MongoDB 바인딩 및 인증 설정

MongoDB가 WAS01에서 접속할 수 있도록 DB01의 내부 IP에도 바인딩합니다.

```bash
sudo vim /etc/mongod.conf
```

`net` 섹션을 확인하고 `<DB01_IP>`를 추가합니다.

```yaml
net:
  port: 27017
  bindIp: 127.0.0.1,<DB01_IP>
```

아직 사용자를 만들기 전이면 `security.authorization`은 잠시 꺼둔 상태로 둡니다. 사용자를 만든 뒤 다시 켭니다.

MongoDB 재시작:

```bash
sudo systemctl restart mongod
sudo systemctl status mongod
```

포트 확인:

```bash
ss -ltnp | grep 27017
```

## 5. DB01 - 관리자 계정과 앱 계정 생성

DB01에서 `mongosh` 접속:

```bash
mongosh
```

관리자 계정 생성:

```javascript
use admin

db.createUser({
  user: "mongo_admin",
  pwd: "CHANGE_ME_ADMIN_PASSWORD",
  roles: [
    { role: "userAdminAnyDatabase", db: "admin" },
    { role: "dbAdminAnyDatabase", db: "admin" },
    { role: "readWriteAnyDatabase", db: "admin" }
  ]
})
```

앱 DB 계정 생성:

```javascript
use stockly_internal

db.createUser({
  user: "stockly_app",
  pwd: "CHANGE_ME_STRONG_PASSWORD",
  roles: [
    { role: "readWrite", db: "stockly_internal" },
    { role: "dbAdmin", db: "stockly_internal" }
  ]
})
```

`dbAdmin`은 Prisma가 컬렉션과 인덱스를 초기 생성할 때 편합니다. 실서비스 보안 강화를 해야 한다면 초기 구축 후 `readWrite` 중심으로 권한 축소를 검토합니다.

`mongosh` 종료:

```javascript
exit
```

이제 인증을 켭니다.

```bash
sudo vim /etc/mongod.conf
```

아래 섹션을 추가하거나 수정합니다.

```yaml
security:
  authorization: enabled
```

MongoDB 재시작:

```bash
sudo systemctl restart mongod
sudo systemctl status mongod
```

인증 확인:

```bash
mongosh "mongodb://mongo_admin:CHANGE_ME_ADMIN_PASSWORD@127.0.0.1:27017/admin"
```

앱 계정 확인:

```bash
mongosh "mongodb://stockly_app:CHANGE_ME_STRONG_PASSWORD@127.0.0.1:27017/stockly_internal?authSource=stockly_internal"
```

## 6. DB01 - 방화벽 설정

pfSense에서 `WAS01 -> DB01:27017/tcp`만 허용하는 것이 1차 방어입니다. DB01 자체 UFW도 켜는 것을 권장합니다.

DB01에서 실행:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <ADMIN_PC_IP_OR_ADMIN_SUBNET> to any port 22 proto tcp
sudo ufw allow from <WAS01_IP> to any port 27017 proto tcp
sudo ufw enable
sudo ufw status verbose
```

관리망 전체를 허용해야 한다면 예를 들어 아래처럼 CIDR을 사용합니다.

```bash
sudo ufw allow from 10.10.99.0/24 to any port 22 proto tcp
```

## 7. WAS01 - Node.js 설치

WAS01에서만 실행합니다.

이 프로젝트는 설치 시 Node 18에서도 동작할 수 있지만, 일부 개발 도구가 Node 20 이상을 요구합니다. 팀 재현성을 위해 Node.js `20.19+` 또는 Node.js `22 LTS`를 사용합니다. 아래는 NodeSource를 이용해 Node 20을 설치하는 예시입니다.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

버전 확인:

```bash
node -v
npm -v
```

권장 예시:

```text
node v20.x 또는 v22.x
npm 10.x 이상
```

빌드에 필요한 기본 패키지:

```bash
sudo apt-get install -y build-essential
```

## 8. WAS01 - 프로젝트 clone

WAS01에서 실행합니다.

```bash
mkdir -p ~/apps
cd ~/apps
git clone <GITHUB_REPOSITORY_URL> external-web
cd external-web
```

예시:

```bash
git clone https://github.com/<ORG_OR_USER>/<REPO>.git external-web
cd external-web
```

현재 브랜치와 파일 확인:

```bash
git status
ls -la
```

## 9. WAS01 - React, Next.js, Prisma 의존성 설치

프로젝트 루트에서 실행합니다.

```bash
npm install
```

이 명령이 설치하는 주요 패키지:

```text
next 15.0.0
react 19.0.0
react-dom 19.0.0
@prisma/client
prisma
tailwindcss
typescript
기타 UI, 인증, 결제, 모니터링 라이브러리
```

설치 후 확인:

```bash
npm ls next react react-dom @prisma/client prisma --depth=0
```

참고:

```text
npm install은 postinstall 스크립트도 실행합니다.
postinstall = node scripts/patch-rsdw-get-outlined-model.js && npx prisma generate
```

따라서 설치 과정에서 Prisma Client가 자동 생성됩니다.

보안 경고가 보일 수 있습니다.

```text
next@15.0.0 보안 경고
react-server-dom-* 보안 경고
npm audit vulnerabilities
```

현재 프로젝트 재현이 목적이면 먼저 lockfile 그대로 설치합니다. 실제 운영 배포 전에는 Next.js와 React Server Components 관련 패키지를 패치 버전으로 올리는 작업을 별도 브랜치에서 검토합니다.

## 10. WAS01 - 환경 변수 설정

프로젝트 루트에서 실행합니다.

```bash
cp .env.db01.example .env
vim .env
```

최소 필수 환경 변수:

```env
DATABASE_URL="mongodb://stockly_app:CHANGE_ME_STRONG_PASSWORD@<DB01_IP>:27017/stockly_internal?authSource=stockly_internal&directConnection=true&maxPoolSize=10"
JWT_SECRET="CHANGE_ME_TO_A_LONG_RANDOM_INTERNAL_SECRET"
NEXT_PUBLIC_API_URL="http://<WAS01_IP>:3000"
NEXT_PUBLIC_APP_URL="http://<WAS01_IP>:3000"
```

`JWT_SECRET`은 긴 랜덤 문자열을 사용합니다.

```bash
openssl rand -base64 48
```

예시:

```env
DATABASE_URL="mongodb://stockly_app:VeryStrongPasswordHere@10.10.20.22:27017/stockly_internal?authSource=stockly_internal&directConnection=true&maxPoolSize=10"
JWT_SECRET="openssl로_생성한_긴_랜덤_문자열"
NEXT_PUBLIC_API_URL="http://10.10.20.21:3000"
NEXT_PUBLIC_APP_URL="http://10.10.20.21:3000"
```

주의:

```text
.env는 절대 GitHub에 올리지 않습니다.
.gitignore에 포함되어 있어야 합니다.
팀 공유가 필요하면 비밀번호 관리 도구 또는 별도 보안 채널을 사용합니다.
```

선택 기능은 필요할 때만 설정합니다.

| Feature | Env |
| --- | --- |
| ImageKit 이미지 업로드 | `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Stripe 결제 | `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| Sentry 모니터링 | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` |
| Redis/QStash | `UPSTASH_REDIS_*`, `QSTASH_*` |

## 11. WAS01 - DB 연결 확인

WAS01에서 DB01 MongoDB 포트 접근 확인:

```bash
nc -vz <DB01_IP> 27017
```

`nc`가 없다면 설치합니다.

```bash
sudo apt-get install -y netcat-openbsd
```

MongoDB 클라이언트로 직접 확인하고 싶으면 `mongosh`를 설치하거나 DB01에서 확인합니다. WAS01에 `mongosh`가 있다면:

```bash
mongosh "$DATABASE_URL" --eval 'db.runCommand({ ping: 1 })'
```

환경 변수 파일을 shell에 직접 로드하지 않은 상태라면 아래처럼 문자열을 직접 넣습니다.

```bash
mongosh "mongodb://stockly_app:CHANGE_ME_STRONG_PASSWORD@<DB01_IP>:27017/stockly_internal?authSource=stockly_internal&directConnection=true" --eval 'db.runCommand({ ping: 1 })'
```

## 12. WAS01 - Prisma 초기화

프로젝트 루트에서 실행합니다.

```bash
npx prisma generate
npx prisma db push
```

역할:

| Command | Purpose |
| --- | --- |
| `npx prisma generate` | `prisma/schema.prisma`를 기준으로 Prisma Client 생성 |
| `npx prisma db push` | MongoDB에 필요한 컬렉션과 인덱스 반영 |

성공하면 Prisma가 MongoDB에 스키마 정보를 반영합니다.

## 13. WAS01 - 데모 데이터 생성

초기 접속과 기능 확인을 위해 내부 데모 데이터를 넣습니다.

```bash
npm run seed:internal-demo
```

생성되는 기본 계정:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@stockly.internal` | `12345678` |
| Client | `client@stockly.internal` | `12345678` |
| Supplier | `supplier@stockly.internal` | `12345678` |

데이터 확인:

```bash
npm run script:check-all-data
npx tsx scripts/verify-demo-accounts.ts
```

실서비스에서는 기본 비밀번호를 그대로 쓰지 않습니다. 데모 확인 후 관리자 페이지에서 비밀번호를 바꾸거나, 운영 데이터 초기화 절차를 별도로 진행합니다.

## 14. WAS01 - 개발 모드 실행

배포 전 빠른 확인:

```bash
npm run dev
```

기본 포트:

```text
http://<WAS01_IP>:3000
```

WAS01에서 직접 확인:

```bash
curl -I http://localhost:3000
```

다른 VM에서 확인:

```bash
curl -I http://<WAS01_IP>:3000
```

개발 모드는 터미널을 닫으면 종료됩니다. 운영용으로는 아래의 build + systemd 방식을 사용합니다.

## 15. WAS01 - 운영 빌드

프로젝트 루트에서 실행합니다.

```bash
npm run build
```

메모리가 작은 VM에서 빌드가 죽으면 아래처럼 실행합니다.

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

빌드 성공 후 운영 서버 실행 테스트:

```bash
npm run start
```

다른 터미널에서 확인:

```bash
curl -I http://localhost:3000
```

테스트가 끝나면 `Ctrl+C`로 종료합니다.

## 16. WAS01 - systemd 서비스 등록

운영에서는 SSH 세션과 무관하게 앱이 살아있도록 systemd 서비스를 등록합니다.

프로젝트 위치가 `~/apps/external-web`라면 실제 절대 경로를 확인합니다.

```bash
pwd
```

예시 절대 경로:

```text
/home/ubuntu/apps/external-web
```

서비스 파일 생성:

```bash
sudo vim /etc/systemd/system/stockly-web.service
```

내용:

```ini
[Unit]
Description=Stockly Next.js Web Service
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/apps/external-web
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

주의:

```text
User, Group, WorkingDirectory는 실제 WAS01 계정과 경로로 수정해야 합니다.
node와 npm 경로가 다르면 which node, which npm으로 확인합니다.
```

서비스 등록 및 시작:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stockly-web
sudo systemctl status stockly-web
```

로그 확인:

```bash
journalctl -u stockly-web -f
```

재시작:

```bash
sudo systemctl restart stockly-web
```

## 17. WAS01 - UFW 방화벽 설정

pfSense에서 `WEB01 -> WAS01:3000/tcp`만 허용하는 것이 우선입니다. WAS01 자체 UFW도 켭니다.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <ADMIN_PC_IP_OR_ADMIN_SUBNET> to any port 22 proto tcp
sudo ufw allow from <WEB01_IP> to any port 3000 proto tcp
sudo ufw enable
sudo ufw status verbose
```

테스트 중 User PC에서 WAS01에 직접 접속해야 하는 경우에만 임시로 허용합니다.

```bash
sudo ufw allow from <USER_PC_IP> to any port 3000 proto tcp
```

테스트 후 제거:

```bash
sudo ufw delete allow from <USER_PC_IP> to any port 3000 proto tcp
```

## 18. WEB01 - Nginx Reverse Proxy 예시

WEB01은 DMZ에 두고, 사용자는 WEB01로만 접속하게 합니다. WEB01에서 WAS01의 `3000/tcp`로 프록시합니다.

WEB01에서 설치:

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

사이트 설정:

```bash
sudo vim /etc/nginx/sites-available/stockly
```

HTTP 예시:

```nginx
server {
    listen 80;
    server_name <DOMAIN>;

    location / {
        proxy_pass http://<WAS01_IP>:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

활성화:

```bash
sudo ln -s /etc/nginx/sites-available/stockly /etc/nginx/sites-enabled/stockly
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS를 사용할 경우 팀 인증서 정책에 맞게 인증서를 배치한 뒤 `listen 443 ssl;` 서버 블록을 추가합니다. 사설망이면 내부 CA 인증서를 쓰고, 공인 도메인이면 Let's Encrypt 또는 조직 인증서를 사용합니다.

HTTPS 적용 후 WAS01의 `.env`도 서비스 URL 기준으로 바꿉니다.

```env
NEXT_PUBLIC_API_URL="https://<DOMAIN>"
NEXT_PUBLIC_APP_URL="https://<DOMAIN>"
```

변경 후 WAS01에서 다시 빌드하고 재시작합니다.

```bash
npm run build
sudo systemctl restart stockly-web
```

## 19. pfSense 정책 체크리스트

최소 정책:

```text
User PC Zone -> WEB01:80,443 허용
WEB01 -> WAS01:3000 허용
WAS01 -> DB01:27017 허용
관리망 -> WEB01/WAS01/DB01:22 허용
그 외 DB01:27017 접근 차단
WAN -> Internal Server Zone 직접 접근 차단
```

권장 로그:

```text
차단된 DB01:27017 접근 로그
WEB01 -> WAS01 프록시 실패 로그
WAS01 -> DB01 연결 실패 로그
SSH 로그인 성공/실패 로그
```

SIEM 또는 LOG01로 보낼 수 있으면 pfSense, Nginx, systemd journal, MongoDB 로그를 수집합니다.

## 20. 배포 후 기능 확인

WAS01:

```bash
sudo systemctl status stockly-web
curl -I http://localhost:3000
```

WEB01:

```bash
curl -I http://<WAS01_IP>:3000
curl -I http://<DOMAIN>
```

DB01:

```bash
sudo systemctl status mongod
mongosh "mongodb://stockly_app:CHANGE_ME_STRONG_PASSWORD@127.0.0.1:27017/stockly_internal?authSource=stockly_internal" --eval 'db.runCommand({ ping: 1 })'
```

브라우저:

```text
http://<DOMAIN>
또는
http://<WEB01_IP>
```

로그인:

```text
admin@stockly.internal / 12345678
client@stockly.internal / 12345678
supplier@stockly.internal / 12345678
```

## 21. 업데이트 배포 절차

WAS01에서 실행합니다.

```bash
cd ~/apps/external-web
git pull
npm install
npx prisma generate
npx prisma db push
npm run build
sudo systemctl restart stockly-web
sudo systemctl status stockly-web
```

문제 발생 시 최근 로그 확인:

```bash
journalctl -u stockly-web -n 100 --no-pager
```

## 22. 백업과 복구

DB01에서 백업 디렉터리 생성:

```bash
sudo mkdir -p /opt/mongodb-backup
sudo chown "$USER":"$USER" /opt/mongodb-backup
```

백업:

```bash
mongodump \
  --uri="mongodb://mongo_admin:CHANGE_ME_ADMIN_PASSWORD@127.0.0.1:27017/admin" \
  --out="/opt/mongodb-backup/$(date +%F-%H%M%S)"
```

복구 예시:

```bash
mongorestore \
  --uri="mongodb://mongo_admin:CHANGE_ME_ADMIN_PASSWORD@127.0.0.1:27017/admin" \
  /opt/mongodb-backup/<BACKUP_DIRECTORY>
```

운영에서는 백업 파일을 DB01 로컬 디스크에만 두지 말고, FS01 또는 별도 백업 저장소로 주기적으로 복사합니다.

## 23. 자주 발생하는 문제

### `Missing required environment variable`

원인:

```text
.env가 없거나 DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_API_URL이 비어 있음
```

해결:

```bash
cp .env.db01.example .env
vim .env
```

### `Prisma cannot connect to MongoDB`

확인:

```bash
nc -vz <DB01_IP> 27017
sudo ufw status verbose
```

점검 대상:

```text
DB01 mongod 실행 여부
DB01 bindIp에 <DB01_IP> 포함 여부
MongoDB authorization 설정
DATABASE_URL 비밀번호와 authSource
pfSense WAS01 -> DB01:27017 허용 여부
DB01 UFW 허용 여부
```

### `npm install`에서 Node engine 경고

원인:

```text
Node.js 버전이 낮음
```

해결:

```bash
node -v
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### `next build`가 메모리 부족으로 종료

해결:

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

VM 메모리가 너무 작으면 4GB 이상으로 늘립니다.

### WEB01에서는 접속되지만 로그인 또는 API가 이상함

확인:

```text
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_APP_URL
Nginx proxy_set_header 설정
HTTP/HTTPS 스킴 불일치
브라우저 캐시
```

환경 변수를 바꾸면 WAS01에서 다시 빌드해야 합니다.

```bash
npm run build
sudo systemctl restart stockly-web
```

### systemd 서비스가 바로 죽음

확인:

```bash
sudo systemctl status stockly-web
journalctl -u stockly-web -n 100 --no-pager
```

주요 원인:

```text
WorkingDirectory 경로 틀림
User/Group이 실제 계정과 다름
.env 누락
npm install 또는 npm run build 미실행
DB 연결 실패
```

## 24. 최종 체크리스트

DB01:

```text
[ ] MongoDB 설치 완료
[ ] mongod enable/start 완료
[ ] bindIp = 127.0.0.1,<DB01_IP>
[ ] security.authorization = enabled
[ ] mongo_admin 생성
[ ] stockly_app 생성
[ ] WAS01에서 27017 접근 가능
[ ] User PC Zone, DMZ에서 DB 직접 접근 차단
```

WAS01:

```text
[ ] Node.js 20.19+ 또는 22 LTS 설치
[ ] Git clone 완료
[ ] npm install 완료
[ ] .env 작성 완료
[ ] npx prisma generate 완료
[ ] npx prisma db push 완료
[ ] npm run seed:internal-demo 완료
[ ] npm run build 완료
[ ] stockly-web systemd 서비스 실행
[ ] WEB01에서 WAS01:3000 접근 가능
```

WEB01:

```text
[ ] Nginx 설치
[ ] server_name 설정
[ ] proxy_pass http://<WAS01_IP>:3000 설정
[ ] nginx -t 성공
[ ] User PC에서 WEB01 접속 가능
[ ] HTTPS 적용 시 NEXT_PUBLIC_API_URL/NEXT_PUBLIC_APP_URL 갱신 후 WAS01 재빌드
```

pfSense:

```text
[ ] User PC Zone -> WEB01:80,443 허용
[ ] WEB01 -> WAS01:3000 허용
[ ] WAS01 -> DB01:27017 허용
[ ] WAN -> Internal Server Zone 차단
[ ] DB01 직접 접근 차단 로그 확인
```

## 25. 참고 명령 모음

프로젝트 루트에서 자주 쓰는 명령:

```bash
npm install
npm run dev
npm run build
npm run start
npx prisma generate
npx prisma db push
npm run seed:internal-demo
npm run script:check-all-data
npx tsx scripts/verify-demo-accounts.ts
```

서비스 운영 명령:

```bash
sudo systemctl status stockly-web
sudo systemctl restart stockly-web
journalctl -u stockly-web -f
```

MongoDB 운영 명령:

```bash
sudo systemctl status mongod
sudo systemctl restart mongod
mongosh "mongodb://mongo_admin:CHANGE_ME_ADMIN_PASSWORD@127.0.0.1:27017/admin"
```
