# Stockly 웹서비스 실행 가이드



## 1. 전체 순서

```text
1. Ubuntu 기본 패키지 설치
2. MongoDB 설치 및 실행
3. MongoDB 앱 계정 생성
4. Node.js 설치
5. GitHub 프로젝트 clone
6. npm install
7. .env 작성
8. Prisma DB 반영
9. demo data 생성
10. 웹서비스 실행
```

## 2. Ubuntu 기본 준비

Ubuntu VM에 접속한 뒤 아래 명령어를 실행합니다. 이미 설치되어 있는 패키지는 `already the newest version`처럼 표시되고 넘어갈 수 있습니다.

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl ca-certificates gnupg git vim build-essential
```

Ubuntu 버전을 확인합니다.

```bash
lsb_release -a
```

이 문서는 Ubuntu 24.04 LTS 기준입니다.

## 3. MongoDB 설치

MongoDB GPG key를 등록합니다.

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg \
  --dearmor
```

MongoDB APT 저장소를 등록합니다.

```bash
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
```

MongoDB를 설치합니다. 이미 설치되어 있다면 새로 설치되지 않고 넘어갑니다.

```bash
sudo apt-get update
sudo apt-get install -y mongodb-org
```

MongoDB를 실행하고 부팅 시 자동 실행되도록 설정합니다.

```bash
sudo systemctl enable --now mongod
sudo systemctl status mongod
```

MongoDB가 살아있는지 확인합니다.

```bash
mongosh --eval 'db.runCommand({ ping: 1 })'
```

정상이라면 `ok: 1`이 보입니다.

## 4. MongoDB 설정 확인

MongoDB 설정 파일을 엽니다.

```bash
sudo vim /etc/mongod.conf
```

`net` 부분의 `bindIp`가 아래처럼 되어 있으면 됩니다.

```yaml
net:
  bindIp: 127.0.0.1
```

이번 실습에서는 웹서비스와 DB가 같은 Ubuntu VM 안에서 실행되므로 MongoDB는 `127.0.0.1`만 사용합니다.

설정을 바꿨다면 MongoDB를 재시작합니다.

```bash
sudo systemctl restart mongod
sudo systemctl status mongod
```

## 5. MongoDB 앱 계정 생성

먼저 `mongosh`에 접속합니다.

```bash
mongosh
```

앱에서 사용할 DB와 계정을 만듭니다.

```javascript
use stockly_internal

db.createUser({
  user: "stockly_app",
  pwd: "stockly_password_1234",
  roles: [
    { role: "readWrite", db: "stockly_internal" },
    { role: "dbAdmin", db: "stockly_internal" }
  ]
})
```

나옵니다.

```javascript
exit
```

비밀번호는 팀 상황에 맞게 바꿔도 됩니다. 다만 MongoDB URL에 그대로 넣을 예정이므로 처음 실습할 때는 `@`, `/`, `:`, `#`, `?`, `&` 같은 특수문자가 없는 비밀번호를 쓰는 편이 덜 헷갈립니다.

## 6. MongoDB 인증 켜기

MongoDB 설정 파일을 다시 엽니다.

```bash
sudo vim /etc/mongod.conf
```

아래 내용을 추가합니다. 이미 `security` 항목이 있다면 그 안에 `authorization: enabled`만 맞춰줍니다.

```yaml
security:
  authorization: enabled
```

MongoDB를 재시작합니다.

```bash
sudo systemctl restart mongod
sudo systemctl status mongod
```

앱 계정으로 접속되는지 확인합니다.

```bash
mongosh "mongodb://stockly_app:stockly_password_1234@127.0.0.1/stockly_internal?authSource=stockly_internal" --eval 'db.runCommand({ ping: 1 })'
```

정상이라면 `ok: 1`이 보입니다.

## 7. Node.js 설치

이 프로젝트는 Node.js 20 이상을 권장합니다.

NodeSource 설치 스크립트를 실행합니다.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
```

Node.js를 설치합니다. 이미 설치되어 있다면 버전 확인만 해도 됩니다.

```bash
sudo apt-get install -y nodejs
```

버전을 확인합니다.

```bash
node -v
npm -v
```

`node -v`가 `v20`으로 시작하면 됩니다.

## 8. 프로젝트 clone

작업할 폴더를 만들고 GitHub에서 프로젝트를 내려받습니다.

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

프로젝트 파일이 보이는지 확인합니다.

```bash
ls -la
```

`package.json`, `package-lock.json`, `prisma`, `app` 폴더가 보이면 정상입니다.

## 9. npm 패키지 설치

프로젝트 루트에서 실행합니다.

```bash
npm install
```

이 명령어가 React, Next.js, Prisma 등 프로젝트에 필요한 패키지를 설치합니다. 따로 `react`, `next`를 하나씩 설치하지 않아도 됩니다.

설치 후 주요 패키지 버전을 확인할 수 있습니다.

```bash
npm ls next react react-dom @prisma/client prisma --depth=0
```

현재 프로젝트 기준 주요 버전은 다음과 같습니다.

```text
next 15.0.0
react 19.0.0
react-dom 19.0.0
@prisma/client 6.x
prisma 6.x
```

설치 중 보안 경고나 audit 경고가 보일 수 있습니다. 실습에서는 우선 `package-lock.json` 기준으로 설치하고 진행합니다.

## 10. .env 작성

프로젝트 루트에서 `.env` 파일을 만듭니다.

```bash
vim .env
```

아래 내용을 넣습니다.

```env
DATABASE_URL="mongodb://stockly_app:stockly_password_1234@127.0.0.1/stockly_internal?authSource=stockly_internal&directConnection=true&maxPoolSize=10"
JWT_SECRET="change_this_to_a_long_random_secret"
NEXT_PUBLIC_API_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

`JWT_SECRET`은 아래 명령어로 만든 값을 넣어도 됩니다.

```bash
openssl rand -base64 48
```

예시:

```env
JWT_SECRET="여기에_openssl_명령어로_생성한_값_붙여넣기"
```

`.env`는 GitHub에 올리면 안 됩니다.

## 11. Prisma DB 반영

Prisma Client를 생성합니다.

```bash
npx prisma generate
```

MongoDB에 프로젝트 스키마를 반영합니다.

```bash
npx prisma db push
```

여기까지 성공하면 웹서비스가 MongoDB를 사용할 준비가 된 것입니다.

## 12. 데모 데이터 생성

초기 로그인과 화면 확인을 위해 데모 데이터를 넣습니다.

```bash
npm run seed:internal-demo
```

생성되는 계정은 다음과 같습니다.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@stockly.internal` | `12345678` |
| Client | `client@stockly.internal` | `12345678` |
| Supplier | `supplier@stockly.internal` | `12345678` |

데이터가 들어갔는지 확인합니다.

```bash
npm run script:check-all-data
npx tsx scripts/verify-demo-accounts.ts
```

## 13. 웹서비스 실행

개발 모드로 실행합니다.

```bash
npm run dev
```

실행 후 브라우저에서 접속합니다.

```text
http://localhost:3000
```

로그인 테스트:

```text
admin@stockly.internal / 12345678
client@stockly.internal / 12345678
supplier@stockly.internal / 12345678
```

터미널에서 종료하려면 `Ctrl+C`를 누릅니다.

## 14. 빌드 후 실행

개발 모드가 아니라 빌드 결과로 실행해보고 싶으면 아래 순서로 진행합니다. 개발 서버를 한 번 실행한 뒤 production 실행을 테스트할 때는 `.next`를 지우고 다시 빌드하는 것이 안전합니다.

```bash
rm -rf .next
npm run build
npm run start
```

브라우저에서 다시 접속합니다.

```text
http://localhost:3000
```

종료하려면 `Ctrl+C`를 누릅니다.

## 15. 자주 쓰는 명령어 모음

MongoDB 상태 확인:

```bash
sudo systemctl status mongod
```

MongoDB 재시작:

```bash
sudo systemctl restart mongod
```

MongoDB 연결 확인:

```bash
mongosh "mongodb://stockly_app:stockly_password_1234@127.0.0.1/stockly_internal?authSource=stockly_internal" --eval 'db.runCommand({ ping: 1 })'
```

프로젝트 폴더 이동:

```bash
cd ~/apps/external-web
```

패키지 재설치:

```bash
npm install
```

Prisma 다시 반영:

```bash
npx prisma generate
npx prisma db push
```

개발 서버 실행:

```bash
npm run dev
```

빌드:

```bash
rm -rf .next
npm run build
```

빌드된 서버 실행:

```bash
npm run start
```

## 16. 문제가 생겼을 때

### `Missing required environment variable` 오류

`.env` 파일이 없거나 필수 값이 빠진 상태입니다.

확인:

```bash
cat .env
```

필수 값:

```text
DATABASE_URL
JWT_SECRET
NEXT_PUBLIC_API_URL
```

### MongoDB 계정 생성에서 이미 존재한다는 오류

같은 VM에서 이 가이드를 두 번째로 따라 하는 경우 `User already exists` 같은 메시지가 나올 수 있습니다. 이미 만든 계정이 있다는 뜻이므로, `.env`의 비밀번호가 처음 만든 비밀번호와 같은지만 확인하고 다음 단계로 넘어가면 됩니다.

### MongoDB 연결 실패

MongoDB 서비스가 실행 중인지 확인합니다.

```bash
sudo systemctl status mongod
```

앱 계정으로 접속되는지 확인합니다.

```bash
mongosh "mongodb://stockly_app:stockly_password_1234@127.0.0.1/stockly_internal?authSource=stockly_internal" --eval 'db.runCommand({ ping: 1 })'
```

`.env`의 `DATABASE_URL` 비밀번호가 MongoDB에서 만든 비밀번호와 같은지 확인합니다.

### `npm install`에서 Node 버전 경고

Node.js 버전이 낮을 가능성이 큽니다.

```bash
node -v
```

`v18` 이하라면 Node.js 20을 다시 설치합니다.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 빌드가 실패하거나 메모리 오류가 날 때

이 프로젝트의 build script는 이미 메모리 옵션을 포함하고 있습니다.

```bash
npm run build
```

그래도 실패하면 에러 메시지의 첫 부분과 마지막 부분을 팀원에게 공유합니다.

## 17. 처음부터 끝까지 한 번에 보는 명령어

아래는 Ubuntu VM에서 프로젝트 폴더에 들어온 뒤 실행하는 핵심 명령어입니다.

```bash
npm install
vim .env
npx prisma generate
npx prisma db push
npm run seed:internal-demo
npm run dev
```

브라우저 접속:

```text
http://localhost:3000
```
