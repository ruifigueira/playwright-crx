/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const HEADER_SIZE = 4; // Uint32
const MAX_MESSAGE_SIZE = 1048575; // Workers size is < 1MB
const FIRST_CHUNK_DATA_SIZE = MAX_MESSAGE_SIZE - HEADER_SIZE;

export const messageToChunks = (data: string): Uint8Array[] => {
  const encoder = new TextEncoder();
  const encodedUint8Array = encoder.encode(data);

  // We only include the header into the first chunk
  const firstChunk = new Uint8Array(
      Math.min(MAX_MESSAGE_SIZE, HEADER_SIZE + encodedUint8Array.length)
  );
  const view = new DataView(firstChunk.buffer);
  view.setUint32(0, encodedUint8Array.length, true);
  firstChunk.set(
      encodedUint8Array.slice(0, FIRST_CHUNK_DATA_SIZE),
      HEADER_SIZE
  );

  const chunks: Uint8Array[] = [firstChunk];
  for (let i = FIRST_CHUNK_DATA_SIZE; i < data.length; i += MAX_MESSAGE_SIZE)
    chunks.push(encodedUint8Array.slice(i, i + MAX_MESSAGE_SIZE));

  return chunks;
};

export const chunksToMessage = (
  chunks: Uint8Array[],
  sessionid: string
): string | null => {
  if (chunks.length === 0)
    return null;


  const emptyBuffer = new Uint8Array(0);
  const firstChunk = chunks[0] || emptyBuffer;
  const view = new DataView(firstChunk.buffer);
  const expectedBytes = view.getUint32(0, true);

  let totalBytes = -HEADER_SIZE;
  for (let i = 0; i < chunks.length; ++i) {
    const curChunk = chunks[i] || emptyBuffer;
    totalBytes += curChunk.length;

    if (totalBytes > expectedBytes) {
      throw new Error(
          `Should have gotten the exact number of bytes but we got more.  SessionID: ${sessionid}`
      );
    }
    if (totalBytes === expectedBytes) {
      const chunksToCombine = chunks.splice(0, i + 1);
      chunksToCombine[0] = firstChunk.subarray(HEADER_SIZE);

      const combined = new Uint8Array(expectedBytes);
      let offset = 0;
      for (let j = 0; j <= i; ++j) {
        const chunk = chunksToCombine[j] || emptyBuffer;
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      const decoder = new TextDecoder();
      // return decoder.decode(combined)
      const message = decoder.decode(combined);
      return message;
    }
  }
  return null;
};
