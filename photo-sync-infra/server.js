const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const cors = require("cors");

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  QueryCommand,
  GetCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

function computeHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

process.env.AWS_PROFILE = "qt-photo-sync";

const REGION = "us-east-1";
const BUCKET_NAME = "photosyncinfrastack-photobucket465738b3-gsb9clalryeg";
const TABLE_NAME = "PhotoSyncInfraStack-PhotoTable2B3A6C45-T0WQAYEMGHA6";

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/upload-url", async (req, res) => {
  try {
    const { fileName, contentType, fileHash, sizeBytes } = req.body;

    if (!fileName || !fileHash) {
      return res.status(400).json({ error: "fileName and fileHash required" });
    }

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
        duplicate: true,
        message: "Duplicate file already uploaded",
        photo: existing.Items[0],
      });
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
      duplicate: false,
      uploadUrl,
      photoId,
      s3Key,
      fileHash,
      sizeBytes,
    });
  } catch (err) {
    console.error("Presign error:", err);
    res.status(500).json({ error: "Failed to create upload URL" });
  }
});

app.post("/upload", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileBuffer = req.file.buffer;
    const fileHash = computeHash(fileBuffer);

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

app.post("/upload-complete", async (req, res) => {
  try {
    const { photoId, fileName, s3Key, contentType, sizeBytes, fileHash } = req.body;

    if (!photoId || !fileName || !s3Key || !fileHash) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const item = {
      photoId,
      fileName,
      s3Key,
      uploadedAt: new Date().toISOString(),
      contentType,
      sizeBytes,
      fileHash,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    res.json({
      message: "Metadata saved",
      duplicate: false,
      photo: item,
    });
  } catch (err) {
    console.error("Finalize error:", err);
    res.status(500).json({ error: "Failed to save metadata" });
  }
});

app.delete("/photos/:photoId", async (req, res) => {
  try {
    const { photoId } = req.params;

    const getResult = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { photoId },
      })
    );

    if (!getResult.Item) {
      return res.status(404).json({ error: "Photo not found" });
    }

    const photo = getResult.Item;

    if (photo.s3Key) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: photo.s3Key,
        })
      );
    }

    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { photoId },
      })
    );

    res.json({
      message: "Photo deleted successfully",
      deleted: {
        photoId: photo.photoId,
        fileName: photo.fileName,
        s3Key: photo.s3Key,
      },
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Failed to delete photo" });
  }
});

app.get("/photos", async (req, res) => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
      })
    );

    const items = (result.Items || [])
      .filter((item) => item && item.s3Key && item.contentType && item.contentType.startsWith("image/"))
      .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));

    const photoResults = await Promise.all(
      items.map(async (item) => {
        try {
          await s3.send(
            new HeadObjectCommand({
              Bucket: BUCKET_NAME,
              Key: item.s3Key,
            })
          );

          const getCommand = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: item.s3Key,
            ResponseContentType: item.contentType || "image/jpeg",
          });

          const imageUrl = await getSignedUrl(s3, getCommand, { expiresIn: 3600 });

          return { ...item, imageUrl };
        } catch (error) {
          console.log("Skipping bad gallery item:", item.s3Key);
          return null;
        }
      })
    );

    res.json({ photos: photoResults.filter(Boolean) });
  } catch (error) {
    console.error("Photos API error:", error);
    res.status(500).json({ error: "Failed to fetch photos" });
  }
});

app.get("/", (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QT Photo Sync</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 1100px;
      margin: 40px auto;
      padding: 0 16px;
    }
    h1 { margin-bottom: 8px; }
    .sub { color: #666; margin-bottom: 24px; }
    .card {
      border: 1px solid #ddd;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 24px;
      background: #fff;
    }
    .toolbar {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    button {
      padding: 10px 14px;
      cursor: pointer;
    }
    pre {
      background: #f6f6f6;
      padding: 12px;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 20px;
    }
    .photo-card {
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
    .label { font-weight: bold; }
    .empty {
      padding: 20px;
      border: 1px dashed #ccc;
      border-radius: 10px;
    }
    .actions { margin-top: 12px; }
  </style>
</head>
<body>
  <h1>QT Photo Sync</h1>
  <div class="sub">Upload, view, deduplicate, and delete photos</div>

  <div class="card">
    <h3>Upload Photo</h3>
    <div class="toolbar">
      <input type="file" id="fileInput" />
      <button id="uploadBtn">Upload</button>
      <button id="refreshBtn">Refresh Gallery</button>
    </div>
    <div style="margin-top: 16px;">
      <strong>Status</strong>
      <div id="status">Idle</div>
    </div>
    <div style="margin-top: 16px;">
      <strong>Response</strong>
      <pre id="output">No response yet.</pre>
    </div>
  </div>

  <div class="card">
    <h3>Gallery</h3>
    <div id="gallery">Loading...</div>
  </div>

  <script>
    const API_BASE_URL = "https://npuctj4dl3.execute-api.us-east-1.amazonaws.com/prod/".replace(/\\/$/, "");

    const fileInput = document.getElementById("fileInput");
    const uploadBtn = document.getElementById("uploadBtn");
    const refreshBtn = document.getElementById("refreshBtn");
    const statusEl = document.getElementById("status");
    const outputEl = document.getElementById("output");
    const galleryEl = document.getElementById("gallery");

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

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
      return hashArray.map(function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    }

    async function loadGallery() {
      galleryEl.textContent = "Loading...";

      try {
        const res = await fetch(API_BASE_URL + "/photos");
        const data = await res.json();

        if (!res.ok) {
          galleryEl.innerHTML = "<div class='empty'>Failed to load gallery.</div>";
          return;
        }

        const photos = data.photos || [];

        if (photos.length === 0) {
          galleryEl.innerHTML = "<div class='empty'>No photos uploaded yet.</div>";
          return;
        }

        let html = '<div class="grid">';

        photos.forEach(function (photo) {
          html += '<div class="photo-card">';
          html += '<img class="thumb" src="' + escapeHtml(photo.imageUrl) + '" alt="' + escapeHtml(photo.fileName || "photo") + '" />';
          html += '<div class="meta"><span class="label">File:</span> ' + escapeHtml(photo.fileName || "") + '</div>';
          html += '<div class="meta"><span class="label">Photo ID:</span> ' + escapeHtml(photo.photoId || "") + '</div>';
          html += '<div class="meta"><span class="label">Uploaded:</span> ' + escapeHtml(photo.uploadedAt || "") + '</div>';
          html += '<div class="meta"><span class="label">Type:</span> ' + escapeHtml(photo.contentType || "") + '</div>';
          html += '<div class="meta"><span class="label">Size:</span> ' + escapeHtml(String(photo.sizeBytes || "")) + '</div>';
          html += '<div class="actions"><button data-photo-id="' + escapeHtml(photo.photoId || "") + '" class="delete-btn">Delete</button></div>';
          html += '</div>';
        });

        html += '</div>';
        galleryEl.innerHTML = html;

        document.querySelectorAll(".delete-btn").forEach(function (button) {
          button.addEventListener("click", function () {
            const photoId = button.getAttribute("data-photo-id");
            deletePhoto(photoId);
          });
        });
      } catch (err) {
        console.error("Gallery UI error:", err);
        galleryEl.innerHTML = "<div class='empty'>Unexpected gallery error.</div>";
      }
    }

    async function deletePhoto(photoId) {
      const confirmed = window.confirm("Delete this photo?");
      if (!confirmed) return;

      const response = await fetch(API_BASE_URL + "/photos/" + photoId, {
        method: "DELETE"
      });

      if (!response.ok) {
        let data = {};
        try {
          data = await response.json();
        } catch (e) {}
        alert(data.error || "Delete failed");
        return;
      }

      await loadGallery();
    }

    uploadBtn.addEventListener("click", async function () {
      const file = fileInput.files[0];

      if (!file) {
        setStatus("Please choose a file first.");
        return;
      }

      try {
        setStatus("Computing SHA-256...");
        const fileHash = await computeSHA256(file);

        setStatus("Requesting presigned URL...");
        const presignRes = await fetch(API_BASE_URL + "/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            fileHash: fileHash
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
          await loadGallery();
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
        const completeRes = await fetch(API_BASE_URL + "/upload-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photoId: presignData.photoId,
            fileName: file.name,
            s3Key: presignData.s3Key,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            fileHash: fileHash
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
        fileInput.value = "";
        await loadGallery();
      } catch (err) {
        console.error("Upload UI error:", err);
        setStatus("Unexpected error.");
        setOutput({ error: String(err) });
      }
    });

    refreshBtn.addEventListener("click", loadGallery);

    loadGallery();
  </script>
</body>
</html>
  `;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});