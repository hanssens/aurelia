import { read, readdir, promises, createReadStream, Dirent } from 'fs';
import { join } from 'path';

const { readFile, writeFile } = promises;

const readdirOpts = {
  encoding: 'utf8' as 'utf8',
  withFileTypes: true as true,
};

export async function getFiles(
  dir: string,
  isMatch: (dir: string, name: string) => boolean = (dir, name) => true,
) {
  const files: File[] = [];
  let pending = 0;

  function $getFiles(
    resolve: (files: File[]) => void,
    reject: (err: NodeJS.ErrnoException) => void,
  ) {
    function walk(dir: string) {
      ++pending;

      function $readdir(err: NodeJS.ErrnoException | null, dirents: Dirent[]) {
        if (err !== null) {
          reject(err);
        }

        let dirent: Dirent;
        const dirents_length = dirents.length;

        for (let i = 0; i < dirents_length; ++i) {
          dirent = dirents[i];
          if (isMatch(dir, dirent.name)) {
            if (dirent.isDirectory()) {
              walk(join(dir, dirent.name));
            } else {
              files.push(new File(join(dir, dirent.name)));
            }
          }
        }

        if (--pending === 0) {
          resolve(files);
        }
      }

      readdir(dir, readdirOpts, $readdir);
    }

    walk(dir);
  }

  return new Promise($getFiles);
}

const emptyBuffer = Buffer.alloc(0);
const BUFFER_SIZE = 4096;

export class File {
  public readonly path: string;
  public content: Buffer;
  private buffer: Buffer;

  constructor(path: string) {
    this.path = path;
    this.content = emptyBuffer;
    this.buffer = emptyBuffer;
  }

  public async restore() {
    await writeFile(this.path, this.buffer);
  }

  public async readContent() {
    return this.content = await readFile(this.path);
  }

  public async hasChanges() {
    if (this.content === emptyBuffer) {
      return false;
    }

    if (this.buffer === emptyBuffer) {
      this.buffer = Buffer.allocUnsafe(BUFFER_SIZE);
    }

    const content = this.content;
    const buffer = this.buffer;

    let offset = 0;
    let bytesRead = 0;

    const stream = createReadStream(this.path);

    function chunksAreEqual() {
      return content.compare(buffer, 0, bytesRead, offset, offset + bytesRead) === 0;
    }

    function streamCompare(
      resolve: (hasChanges: boolean) => void,
      reject: (err: NodeJS.ErrnoException) => void,
    ) {
      async function onStreamOpen(descriptor: number) {
        function $read(resolve: (bytesRead: number) => void) {
          function callback(err: NodeJS.ErrnoException | null, bytesRead: number) {
            if (err !== null) {
              reject(err);
            }

            resolve(bytesRead);
          }

          read(descriptor, buffer, 0, BUFFER_SIZE, BUFFER_SIZE, callback);
        }

        do {
          bytesRead = await new Promise($read);
          if (chunksAreEqual()) {
            offset += bytesRead;
          } else {
            stream.destroy();
            resolve(true);
          }
        } while (bytesRead === BUFFER_SIZE);

        stream.destroy();

        if (chunksAreEqual()) {
          resolve(false);
        } else {
          resolve(true);
        }
      }

      stream.on('open', onStreamOpen);
    }

    return new Promise(streamCompare);
  }
}
