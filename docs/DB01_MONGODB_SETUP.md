# DB01 MongoDB Setup for WAS01 Next.js

Target architecture:

```text
WAS01 / Ubuntu VM
└─ Next.js app

DB01 / Ubuntu VM
└─ MongoDB
```

## 1. Configure MongoDB on DB01

Install MongoDB on DB01 using the team's approved package source. After installation, configure MongoDB to listen on the DB01 internal-server-zone IP.

Edit `/etc/mongod.conf` on DB01:

```yaml
net:
  port: 27017
  bindIp: 127.0.0.1,<DB01_IP>

security:
  authorization: enabled
```

Restart MongoDB:

```bash
sudo systemctl restart mongod
sudo systemctl enable mongod
sudo systemctl status mongod
```

## 2. Create the application database user on DB01

Open `mongosh` on DB01 as an admin user and run:

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

The `dbAdmin` role is useful for Prisma index creation during lab setup. For a stricter production posture, remove it after schema/index setup if the app no longer needs it.

## 3. Allow only WAS01 to reach DB01

pfSense should allow:

```text
WAS01_IP -> DB01_IP:27017/tcp
```

Block direct access from WAN, DMZ, and User PC Zone unless the team has a specific admin path.

## 4. Configure WAS01

On WAS01, from the project root:

```bash
cp .env.db01.example .env
nano .env
```

Set:

```env
DATABASE_URL="mongodb://stockly_app:CHANGE_ME_STRONG_PASSWORD@<DB01_IP>:27017/stockly_internal?authSource=stockly_internal&directConnection=true&maxPoolSize=10"
JWT_SECRET="CHANGE_ME_TO_A_LONG_RANDOM_INTERNAL_SECRET"
NEXT_PUBLIC_API_URL="http://<WAS01_IP>:3000"
NEXT_PUBLIC_APP_URL="http://<WAS01_IP>:3000"
```

Then run:

```bash
npx prisma generate
npx prisma db push
npm run seed:internal-demo
npm run script:check-all-data
```

## 5. Build on WAS01

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

## Verification

Expected high-level checks:

```bash
npm ls next react react-dom react-server-dom-webpack react-server-dom-turbopack react-server-dom-parcel --depth=0
npx prisma db push
npm run seed:internal-demo
npm run build
```
