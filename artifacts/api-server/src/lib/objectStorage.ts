import { Storage, type File } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function getPublicObjectSearchPaths(): string[] {
  const paths = (process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  if (paths.length === 0) {
    throw new Error("PUBLIC_OBJECT_SEARCH_PATHS is not configured.");
  }
  return [...new Set(paths)];
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error("Invalid public object search path.");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

export async function searchPublicObject(filePath: string): Promise<File | null> {
  const normalizedFilePath = filePath.replace(/^\/+/, "");
  if (
    !normalizedFilePath
    || normalizedFilePath.split("/").some((part) =>
      !part || part === "." || part === ".." || part.includes("\\")
    )
  ) {
    return null;
  }

  for (const searchPath of getPublicObjectSearchPaths()) {
    const { bucketName, objectName } = parseObjectPath(`${searchPath}/${normalizedFilePath}`);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (exists) return file;
  }
  return null;
}
