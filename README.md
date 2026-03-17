
### Setup

```bash
mkdir photo-sync-infra
cd photo-sync-infra

npm init -y
npm install aws-cdk-lib constructs
npm install -D aws-cdk typescript ts-node @types/node esbuild

rm -rf node_modules package-lock.json package.json
npx cdk init app --language typescript

nvm install --lts
nvm use --lts
node -v
npm -v

npx aws-cdk init app --language typescript
npm install aws-cdk-lib constructs
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install -D esbuild

brew install awscli
aws --version
```

login<br>
```bash
% aws login
No AWS region has been configured. The AWS region is the geographic location of your AWS resources.

If you have used AWS before and already have resources in your account, specify which region they were created in. If you have not created resources in your account before, you can pick the region closest to you: https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html.

You are able to change the region in the CLI at any time with the command "aws configure set region NEW_REGION".
AWS Region [us-east-1]:
Attempting to open your default browser.
If the browser does not open, open the following URL:

https://us-east-1.signin.aws.amazon.com/v1/authorize?response_type=code&client_id=arn%3Aaws%3Asignin%3A%3A%3Adevtools%2Fsame-device&state=699dade7-441b-49df-a2fc-a56677821d21&code_challenge_method=SHA-256&scope=openid&redirect_uri=http%3A%2F%2F127.0.0.1%3A50934%2Foauth%2Fcallback&code_challenge=UC4DI9RI6KQaMICPzaPYvN13NxWpz7Xm1NqQ4mVGY4Q

```
create user<br>
```bash
aws iam create-user --user-name qt-photo-sync-user

```
attach policy <br>
```bash
aws iam attach-user-policy \
  --user-name qt-photo-sync-user \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
```

create access keys<br>
```bash
aws iam create-access-key --user-name photo-sync-user
```

create group <br>
```bash
aws iam create-group --group-name photo-sync-group
```

Create access keys for your user<br>
```bash
aws iam create-access-key --user-name qt-photo-sync-user
```

create a named profile<br>
```bash
aws configure --profile qt-photo-sync
```
for region use `us-east-1`<br>


install cdk<br>
```bash
npm install -g aws-cdk
cdk --version
```

edit your cdk stack file<br>
```bash
vim lib/photo-sync-infra-stack.ts
```
replace contents with this minimal stack. This creates S3 Bucket and Dynamo DB table.<br>
```bash
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class PhotoSyncInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for photos
    const bucket = new s3.Bucket(this, 'PhotoBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ok for prototype
      autoDeleteObjects: true,
    });

    // DynamoDB table for metadata
    const table = new dynamodb.Table(this, 'PhotoTable', {
      partitionKey: { name: 'photoId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
    });
  }
}
```

attach admin access to group<br>
```bash
aws iam attach-group-policy \
  --group-name qt-photo-sync-group \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess \
  --profile qt-photo-sync
```

Do this via the browser:<br>

Step A — log in as root (console)<br>

Go to: https://console.aws.amazon.com/<br>

Choose Root user<br>

Enter your AWS account email + password<br>

Step B — attach admin policy<br>

Go to IAM:<br>

IAM → User groups<br>

Click qt-photo-sync-group<br>

Click Add permissions<br>
Choose “Attach policies.” from the dropdown<br>

Search for:<br>

AdministratorAccess<br>

Check the box<br>

Click Add permissions<br>

bootstrap: Wait ~10–20 seconds, then go back to terminal and run:<br>
```bash
cdk bootstrap --profile qt-photo-sync                                 
```

deploy<br>
```bash
cdk deploy --profile qt-photo-sync 
```

You are fully past the infrastructure hurdle.

You now have:

an IAM user/profile that works

CDK bootstrapped successfully

an S3 bucket deployed

a DynamoDB table deployed


verify resources from the cli
```aws s3 ls s3://photosyncinfrastack-photobucket99999999-xxxxxxxxxxxx --profile qt-photo-sync

aws dynamodb describe-table \
  --table-name PhotoSyncInfraStack-PhotoTablexxxxxxxx-xxxxxxxxxxxxx \
  --profile qt-photo-sync
```

Then do one quick real test

Create a tiny file:
```bash
echo "hello photo sync" > test-upload.txt
```

upload it<br>
```bash
aws s3 cp test-upload.txt s3://photosyncinfrastack-photobucketxxxxxxxx-xxxxxxxxxxxx/ --profile qt-photo-sync
```

list bucket contents<br>
```bash
aws s3 ls s3://photosyncinfrastack-photobucket465738b3-xxxxxxxxxxxx --profile qt-photo-sync
```

test DynamoDB write<br>
```bash
aws dynamodb put-item \
  --table-name PhotoSyncInfraStack-PhotoTablexxxxxxxx-xxxxxxxxxxxxx \
  --item '{
    "photoId": {"S": "test-1"},
    "fileName": {"S": "test-upload.txt"},
    "s3Key": {"S": "test-upload.txt"}
  }' \
  --profile qt-photo-sync
```

read it back<br>
```bash
aws dynamodb get-item \
  --table-name PhotoSyncInfraStack-PhotoTablexxxxxxxx-xxxxxxxxxxxxxx \
  --key '{
    "photoId": {"S": "test-1"}
  }' \
  --profile qt-photo-sync
```

### App Layer
Have your app do this flow:

accept a file

generate a photoId

upload the file to S3

write metadata to DynamoDB

return a success response with the S3 key and photo ID

Minimal Node.js example
```bash
npm install @aws-sdk/client-s3 @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

create upload-photo.js and paste this in: 
```
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = "us-east-1";
const BUCKET_NAME = "photosyncinfrastack-photobucket465738b3-ug7z83mjp8cx";
const TABLE_NAME = "PhotoSyncInfraStack-PhotoTable2B3A6C45-1RYSICT0BU8N5";
const PROFILE = "qt-photo-sync";

process.env.AWS_PROFILE = PROFILE;

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function uploadPhoto(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const photoId = crypto.randomUUID();
  const s3Key = `uploads/${photoId}-${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileBuffer,
    })
  );

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        photoId,
        fileName,
        s3Key,
        uploadedAt: new Date().toISOString(),
      },
    })
  );

  return { photoId, fileName, s3Key };
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: node upload-photo.js <path-to-file>");
    process.exit(1);
  }

  try {
    const result = await uploadPhoto(filePath);
    console.log("Upload successful:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Upload failed:");
    console.error(err);
    process.exit(1);
  }
}

main();
```

Run it: 
```bash
node upload-photo.js ./test-upload.txt
```

here we do the same test with a jpeg: 
```bash
node upload-photo.js ./on1.jpeg  
```

check your s3 bucket in the web console and verify these items were uploaded and have no defects. 

----

What this gives you in an interview

You can now say:

infrastructure is defined in CDK

files are stored in S3

metadata is stored in DynamoDB

the app coordinates both services

the whole stack is reproducible

----

### Create a minimal server with two endpoints:
POST /upload — uploads a file to S3 and writes metadata to DynamoDB

GET /photos — lists uploaded photo metadata from DynamoDB

install dependencies:
```bash
npm install express multer
```

create server.js and paste these contents: 
```
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

process.env.AWS_PROFILE = "qt-photo-sync";

const REGION = "us-east-1";
const BUCKET_NAME = "photosyncinfrastack-photobucket465738b3-ug7z83mjp8cx";
const TABLE_NAME = "PhotoSyncInfraStack-PhotoTable2B3A6C45-1RYSICT0BU8N5";

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const photoId = crypto.randomUUID();
    const fileName = req.file.originalname;
    const s3Key = `uploads/${photoId}-${fileName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || "application/octet-stream",
      })
    );

    const item = {
      photoId,
      fileName,
      s3Key,
      uploadedAt: new Date().toISOString(),
      contentType: req.file.mimetype || "application/octet-stream",
      sizeBytes: req.file.size,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    res.status(201).json({
      message: "Upload successful",
      photo: item,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.get("/photos", async (req, res) => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      })
    );

    res.json({
      count: result.Items?.length || 0,
      photos: result.Items || [],
    });
  } catch (error) {
    console.error("List error:", error);
    res.status(500).json({ error: "Failed to fetch photos" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

run it: 
```bash
node server.js
```

the server will run in that console. In a new console test health:
```
% curl http://localhost:3000/health
``` 

test upload:
```
curl -X POST http://localhost:3000/upload \
  -F "photo=@./on1.jpeg"

```

Add duplicate detection using a file hash (SHA-256)
Add a GSI to DynamoDB (for fast lookup by hash)

Update your CDK stack (lib/...stack.ts):

```
table.addGlobalSecondaryIndex({
  indexName: 'fileHash-index',
  partitionKey: { name: 'fileHash', type: dynamodb.AttributeType.STRING },
});
```

then deploy
```bash
cdk deploy --profile qt-photo-sync
```

Update your API to hash files. Modify server.js:
Add helper:
```
const crypto = require("crypto");

function computeHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
```

Update /upload route

Replace your current handler with this version:
```
const { QueryCommand } = require("@aws-sdk/lib-dynamodb");

app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileBuffer = req.file.buffer;
    const fileHash = computeHash(fileBuffer);

    // 1. Check for duplicate using GSI
    const existing = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "fileHash-index",
        KeyConditionExpression: "fileHash = :hash",
        ExpressionAttributeValues: {
          ":hash": fileHash,
        },
        Limit: 1,
      })
    );

    if (existing.Items && existing.Items.length > 0) {
      return res.status(200).json({
        message: "Duplicate file already uploaded",
        photo: existing.Items[0],
        duplicate: true,
      });
    }

    // 2. Proceed with upload
    const photoId = crypto.randomUUID();
    const fileName = req.file.originalname;
    const s3Key = `uploads/${photoId}-${fileName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: req.file.mimetype || "application/octet-stream",
      })
    );

    const item = {
      photoId,
      fileName,
      s3Key,
      fileHash,
      uploadedAt: new Date().toISOString(),
      contentType: req.file.mimetype || "application/octet-stream",
      sizeBytes: req.file.size,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    res.status(201).json({
      message: "Upload successful",
      photo: item,
      duplicate: false,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});
```

test it. upload the same file twice. 
```
curl -X POST http://localhost:3000/upload \
  -F "photo=@./on1.jpeg"

curl -X POST http://localhost:3000/upload \
  -F "photo=@./on1.jpeg"

```

expected: 
```
Expected behavior:

First upload:

{
  "duplicate": false
}

Second upload:

{
  "duplicate": true,
  "message": "Duplicate file already uploaded"
}

And no second S3 object is created.
```

What you just achieved

Content-based deduplication (real-world pattern)

Efficient lookup via DynamoDB GSI

Clean API behavior (idempotent uploads)

### Presigned URL flow (upgrade your architecture)
What changes conceptually

Current flow (what you built):

Client → Node server → S3
                → DynamoDB

New flow (better):

Client → Node server (get URL)
Client → S3 (direct upload)
Client → Node server (save metadata)
Why this is better

No large file handling in your server

Scales much better

Standard production pattern

install one package:
```
npm install @aws-sdk/s3-request-presigner
```

Add new endpoint /upload-url

Add this to server.js:

```
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

app.post("/upload-url", express.json(), async (req, res) => {
  try {
    const { fileName, contentType } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: "fileName required" });
    }

    const photoId = crypto.randomUUID();
    const s3Key = `uploads/${photoId}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: contentType || "application/octet-stream",
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    res.json({
      uploadUrl,
      photoId,
      s3Key,
    });
  } catch (err) {
    console.error("Presign error:", err);
    res.status(500).json({ error: "Failed to create upload URL" });
  }
});
```

test the full flow
```
curl -X POST http://localhost:3000/upload-url \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "on1.jpeg",
    "contentType": "image/jpeg"
  }'
```

grab uploadUrl from the response

and paste it into this s3 upload command

```
curl -X PUT "<uploadUrl>" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@./on1.jpeg"
```

finalize metadata
```
curl -X POST http://localhost:3000/upload-complete \
  -H "Content-Type: application/json" \
  -d '{
    "photoId": "...",
    "fileName": "on1.jpeg",
    "s3Key": "...",
    "contentType": "image/jpeg",
    "sizeBytes": 12345
  }'
```

“I started with a simple server-upload model, then evolved it to a presigned URL architecture so clients upload directly to S3. This removes load from the backend and is the standard scalable pattern.”

update deduplication code to use presigned urls

“I started with a simple server-upload model, then evolved it to a presigned URL architecture so clients upload directly to S3. This removes load from the backend and is the standard scalable pattern.”

A malicious client could lie about the hash. For a prototype, that is acceptable. In production, you would validate more carefully, possibly with a post-upload verification step or checksum enforcement.

Update /upload-url

Have it accept fileHash, then query fileHash-index before generating the signed URL.

make an index.html in the root dir and paste these contents: 
```
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QT Photo Sync Demo</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 700px;
      margin: 40px auto;
      padding: 0 16px;
    }
    .card {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
    }
    button {
      padding: 10px 14px;
      cursor: pointer;
    }
    pre {
      background: #f6f6f6;
      padding: 12px;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <h1>QT Photo Sync Demo</h1>
  <p>Select a file and upload it using a presigned S3 URL.</p>

  <input type="file" id="fileInput" />
  <button id="uploadBtn">Upload</button>

  <div class="card">
    <h3>Status</h3>
    <div id="status">Idle</div>
  </div>

  <div class="card">
    <h3>Response</h3>
    <pre id="output">No response yet.</pre>
  </div>

  <script>
    const fileInput = document.getElementById("fileInput");
    const uploadBtn = document.getElementById("uploadBtn");
    const statusEl = document.getElementById("status");
    const outputEl = document.getElementById("output");

    function setStatus(msg) {
      statusEl.textContent = msg;
    }

    function setOutput(obj) {
      outputEl.textContent = JSON.stringify(obj, null, 2);
    }

    async function computeSHA256(file) {
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    uploadBtn.addEventListener("click", async () => {
      const file = fileInput.files[0];

      if (!file) {
        setStatus("Please choose a file first.");
        return;
      }

      try {
        setStatus("Computing SHA-256...");
        const fileHash = await computeSHA256(file);

        setStatus("Requesting presigned URL...");
        const presignRes = await fetch("http://localhost:3000/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            fileHash
          })
        });

        const presignData = await presignRes.json();

        if (!presignRes.ok) {
          setStatus("Failed to get upload URL.");
          setOutput(presignData);
          return;
        }

        if (presignData.duplicate) {
          setStatus("Duplicate detected. Upload skipped.");
          setOutput(presignData);
          return;
        }

        setStatus("Uploading directly to S3...");
        const uploadRes = await fetch(presignData.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream"
          },
          body: file
        });

        if (!uploadRes.ok) {
          const uploadText = await uploadRes.text();
          setStatus("S3 upload failed.");
          setOutput({ status: uploadRes.status, body: uploadText });
          return;
        }

        setStatus("Finalizing metadata...");
        const completeRes = await fetch("http://localhost:3000/upload-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photoId: presignData.photoId,
            fileName: file.name,
            s3Key: presignData.s3Key,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            fileHash
          })
        });

        const completeData = await completeRes.json();

        if (!completeRes.ok) {
          setStatus("Metadata save failed.");
          setOutput(completeData);
          return;
        }

        setStatus("Upload complete.");
        setOutput(completeData);
      } catch (err) {
        setStatus("Unexpected error.");
        setOutput({ error: String(err) });
      }
    });
  </script>
</body>
</html>
```

Make sure your server.js has CORS support
Because your HTML page and API may be served from different origins, add CORS.

```
npm install cors
```

Then update server.js near the top:
```
const cors = require("cors");
```

And after const app = express(); add:

```
app.use(cors());
app.use(express.json());
```
Make sure your presigned endpoints are the updated dedupe versions

Your server.js should now have:

POST /upload-url accepting fileHash

POST /upload-complete storing fileHash

Serve the HTML page

From the folder containing index.html, run:
```
python3 -m http.server 8080
```

then open: 
```
http://localhost:8080
```

reStart your Node.js backend
```
node server.js
```

test the browser flow

In the page:

pick on1.jpeg

click Upload

Expected behavior:

first upload succeeds

second upload of the same file says duplicate and skips S3 upload

“I built a small browser client that computes SHA-256 client-side, requests a presigned URL from the backend, uploads directly to S3, then finalizes metadata in DynamoDB. I also added content-based deduplication using a hash lookup.”

You already have GET /photos returning JSON. Now make it return a simple gallery page with the uploaded images.

What needs to change

Right now your table stores:

photoId

fileName

s3Key

metadata

To render images in a browser, you also need a way for the browser to access the actual S3 objects.

There are two common options:

make the bucket objects public

generate presigned GET URLs

Use presigned GET URLs. It is cleaner and safer.

Plan

Update GET /photos so it:

reads items from DynamoDB

generates a signed download URL for each S3 object

returns an HTML page showing each image

Step 1: update imports in server.js

At the top, make sure you have:
```
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const crypto = require("crypto");

const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
```
The key new import is GetObjectCommand.

replace your current GET /photos. Use this route:
```
app.get("/photos", async (req, res) => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      })
    );

    const items = result.Items || [];

    const photosWithUrls = await Promise.all(
      items.map(async (item) => {
        const getCommand = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: item.s3Key,
        });

        const imageUrl = await getSignedUrl(s3, getCommand, { expiresIn: 3600 });

        return {
          ...item,
          imageUrl,
        };
      })
    );

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>QT Photo Sync Gallery</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 1100px;
            margin: 40px auto;
            padding: 0 16px;
          }
          h1 {
            margin-bottom: 8px;
          }
          .sub {
            color: #666;
            margin-bottom: 24px;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 20px;
          }
          .card {
            border: 1px solid #ddd;
            border-radius: 10px;
            padding: 12px;
            background: #fff;
          }
          .thumb {
            width: 100%;
            height: 220px;
            object-fit: cover;
            border-radius: 8px;
            background: #f3f3f3;
            display: block;
          }
          .meta {
            margin-top: 10px;
            font-size: 14px;
            line-height: 1.4;
            word-break: break-word;
          }
          .label {
            font-weight: bold;
          }
          .empty {
            padding: 20px;
            border: 1px dashed #ccc;
            border-radius: 10px;
          }
        </style>
      </head>
      <body>
        <h1>QT Photo Sync Gallery</h1>
        <div class="sub">Uploaded photos stored in S3 with metadata from DynamoDB</div>

        ${
          photosWithUrls.length === 0
            ? `<div class="empty">No photos uploaded yet.</div>`
            : `<div class="grid">
                ${photosWithUrls
                  .map(
                    (photo) => `
                  <div class="card">
                    <img class="thumb" src="${photo.imageUrl}" alt="${photo.fileName || "photo"}" />
                    <div class="meta"><span class="label">File:</span> ${photo.fileName || ""}</div>
                    <div class="meta"><span class="label">Photo ID:</span> ${photo.photoId || ""}</div>
                    <div class="meta"><span class="label">S3 Key:</span> ${photo.s3Key || ""}</div>
                    <div class="meta"><span class="label">Uploaded:</span> ${photo.uploadedAt || ""}</div>
                    <div class="meta"><span class="label">Type:</span> ${photo.contentType || ""}</div>
                    <div class="meta"><span class="label">Size:</span> ${photo.sizeBytes || ""}</div>
                  </div>
                `
                  )
                  .join("")}
              </div>`
        }
      </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error) {
    console.error("Gallery error:", error);
    res.status(500).send("Failed to render gallery");
  }
});
```


