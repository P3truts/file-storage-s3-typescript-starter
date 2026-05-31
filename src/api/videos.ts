import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
import path from "path";
import { randomBytes } from "crypto";


export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  console.log("video id before guard: ", videoId);
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const MAX_UPLOAD_SIZE = 1 << 30;

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video", videoId, "by user", userID);
  const videoMeta = getVideo(cfg.db, videoId);

  console.log("video.userID:", videoMeta?.userID, "jwt userID:", userID);
  if (videoMeta?.userID !== userID) {
    throw new UserForbiddenError("Forbidden");
  }

  const formData = await req.formData();
  const videoData = formData.get("video");
  if (!(videoData instanceof File)) {
    throw new BadRequestError("Video file missing!");
  }
  if (videoData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video size larger than accepted 1GB limit");
  }

  const mediaType = videoData.type;
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Only MP4 format allowed");
  }

  const arrayBufer = await videoData.arrayBuffer();
  const fileExtension = mediaType.replace("video/", '');
  const buf = randomBytes(32);
  const fileName = buf.toString("hex");
  const key = `${fileName}.${fileExtension}`;
  const videoFilePath = `${cfg.assetsRoot}/${key}`;
  const videoPath = path.join(process.cwd(), videoFilePath);
  await Bun.write(videoPath, arrayBufer);
  const outputFilePath = await processVideoForFastStart(videoPath);

  console.log("Video path: ", outputFilePath);
  const ratio = await getVideoAspectRatio(outputFilePath);
  const prefixedKey = `${ratio}/${key}`;

  console.log({ fileName, fileExtension, key: prefixedKey });
  const tempFile = Bun.file(outputFilePath);
  const videoFile = cfg.s3Client.file(prefixedKey, { bucket: cfg.s3Bucket });
  await videoFile.write(tempFile, {
    type: mediaType,
  });

  const videoURL = `https://${cfg.s3CfDistribution}/${prefixedKey}`;
  console.log("VideoURL: ", videoURL);
  videoMeta.videoURL = videoURL;

  updateVideo(cfg.db, videoMeta);
  await tempFile.delete();

  return respondWithJSON(200, videoMeta);
}

async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath], { stdout: "pipe", stderr: "pipe" });
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  const res = await proc.exited;
  if (res != 0) {
    console.log("There is an error determining the ratio of the video!");
  }

  console.log("Stdout: ", stdoutText);
  console.log("Stderr: ", stderrText);

  const json = JSON.parse(stdoutText);
  const { width, height } = json.streams[0];

  const ratio = Math.round((width / height) * 100) / 100;
  if (ratio === 0.56) {
    return "portrait";
  } else if (ratio === 1.78) {
    return "landscape";
  } else {
    return "other";
  }
}

async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = inputFilePath + ".processed";


  const proc = Bun.spawn(["ffmpeg", "-i", inputFilePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputFilePath], { stdout: "pipe", stderr: "pipe" });
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  const res = await proc.exited;
  if (res != 0) {
    console.log("There is an error processing the video!");
  }

  console.log("Stdout: ", stdoutText);
  console.log("Stderr: ", stderrText);

  return outputFilePath;
}

