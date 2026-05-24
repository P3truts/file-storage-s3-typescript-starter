import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo, type Video } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

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
  const arrayBufer = await imgData.arrayBuffer();
  const buffer = Buffer.from(arrayBufer);
  const imgString = buffer.toString("base64");
  const dataURL = `data:${mediaType};base64,${imgString}`;

  const videoMeta = getVideo(cfg.db, videoId);
  if (videoMeta?.userID !== userID) {
    throw new UserForbiddenError("Forbidden");
  }

  videoMeta.thumbnailURL = dataURL;

  updateVideo(cfg.db, videoMeta);

  return respondWithJSON(200, videoMeta);
}
