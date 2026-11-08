import { Router, type IRouter } from "express";
import { searchPublicObject } from "../lib/objectStorage";

const router: IRouter = Router();

router.get("/storage/public-objects/*filePath", async (req, res): Promise<void> => {
  const rawPath = req.params.filePath;
  const filePath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;

  try {
    const file = await searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "Image not found." });
      return;
    }

    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", metadata.contentType ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));

    const stream = file.createReadStream();
    stream.on("error", (error) => {
      req.log.error({ err: error }, "Error streaming public item image");
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.status(500).json({ error: "Failed to serve image." });
    });
    stream.pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "Error finding public item image");
    res.status(500).json({ error: "Failed to serve image." });
  }
});

export default router;
