import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo, type Video } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const buf = randomBytes(256);
  const fileName = buf.toString("base64");

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const imgData = formData.get("thumbnail");
  if (!(imgData instanceof File)) {
    throw new BadRequestError("Thumbnail file missing!");
  }
  const MAX_UPLOAD_SIZE = 10 << 20;
  if (imgData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Image size larger than accepted 10MB limit");
  }

  const mediaType = imgData.type;
  if (mediaType !== "image/jpeg" && mediaType !== "image/png") {
    throw new BadRequestError("Only JPEG or PNG format allowed");
  }

  const arrayBufer = await imgData.arrayBuffer();
  const fileExtension = mediaType.replace("image/", '');
  const videoFile = `${cfg.assetsRoot}/${fileName}.${fileExtension}`;
  const thumbnailPath = path.join(process.cwd(), videoFile);
  await Bun.write(thumbnailPath, arrayBufer);

  const videoMeta = getVideo(cfg.db, videoId);
  if (videoMeta?.userID !== userID) {
    throw new UserForbiddenError("Forbidden");
  }

  const thumbnailURL = `http://localhost:${cfg.port}/${videoFile}`;
  console.log("ThumbnailURL: ", thumbnailURL);
  videoMeta.thumbnailURL = thumbnailURL;

  updateVideo(cfg.db, videoMeta);

  return respondWithJSON(200, videoMeta);
}
