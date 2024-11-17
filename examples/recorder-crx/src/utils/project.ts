import type { JsonConfig, JsonProject, JsonSuite, TeleReporterReceiver } from '@testIsomorphic/teleReceiver';
import { sha1 } from './sha1';
import { VirtualFile, VirtualFs } from 'src/utils/virtualFs';

type TeleReporterReceiverEventMap = {
  onConfigure: {
    method: 'onConfigure';
    params: {
      config: Parameters<TeleReporterReceiver['_onConfigure']>[0];
    };
  };
  onProject: {
    method: 'onProject';
    params: {
      project: Parameters<TeleReporterReceiver['_onProject']>[0];
    };
  };
  onBegin: {
    method: 'onBegin';
    params: {};
  };
  onTestBegin: {
    method: 'onTestBegin';
    params: {
      testId: Parameters<TeleReporterReceiver['_onTestBegin']>[0];
      result: Parameters<TeleReporterReceiver['_onTestBegin']>[1];
    };
  };
  onEnd: {
    method: 'onEnd';
    params: {
      result: Parameters<TeleReporterReceiver['_onEnd']>[0];
    };
  };
  onTestEnd: {
    method: 'onTestEnd';
    params: {
      test: Parameters<TeleReporterReceiver['_onTestEnd']>[0];
      result: Parameters<TeleReporterReceiver['_onTestEnd']>[1];
    };
  };
};

type TeleReporterReceiverEvent = TeleReporterReceiverEventMap[keyof TeleReporterReceiverEventMap];
export type TeleReporter = TeleReporterReceiverEvent[];

function generateHexString(length: number = 32) {
  let hexString = '';
  for (let i = 0; i < length; i++) {
      hexString += Math.floor(Math.random() * 16).toString(16);
  }
  return hexString;
}

async function getSuitesRecursively(fs: VirtualFs, directory: VirtualFile = fs.root()): Promise<{ suite: JsonSuite, onTestBegin: TeleReporterReceiverEventMap['onTestBegin'], onTestEnd: TeleReporterReceiverEventMap['onTestEnd'] }[]> {
  const relativePath = directory.path;
  const children = await fs.listFiles(directory.path);
  const files = children.filter(h => h.kind === 'file');
  const zipFiles = files.filter(f => f.name.endsWith('.zip'));
  const filesByName = new Map(files.map(f => [f.name, f]));
  const fileEntries = await Promise.all(zipFiles.map(async zipFile => {
    const jsonFile = filesByName.get(zipFile.name.replace(/\.zip$/, '.json'));
    let title = 'test';
    if (jsonFile) {
      const jsonData = await fs.readFile(jsonFile.path, { encoding: 'utf-8' });
      title = JSON.parse(jsonData)?.title ?? 'test';
    }
    const testFilename = zipFile.name.replace(/\.zip$/, '.ts');
    const fileId = sha1(relativePath).slice(0, 20);
    const testIdExpression = `[project=]${relativePath}/${testFilename}\x1e${title}`;
    const testId = fileId + '-' + sha1(testIdExpression).slice(0, 20);
    const testPath = relativePath ? `${relativePath}/${testFilename}` : testFilename;
    const zipPath = zipFile.path;

    const suite = {
      title: testPath,
      location: { file: testPath, column: 0, line: 0 },
      entries: [{
        testId,
        title,
        location: { file: testPath, line: 3, column: 5 },
        retries: 0,
        tags: [],
        repeatEachIndex: 0,
        annotations: []
      }],
    } satisfies JsonSuite;

    const testRunId = generateHexString();
    const onTestBegin = {
      method: 'onTestBegin',
      params: {
        testId,
        result: {
          id: testRunId,
          retry: 0,
          workerIndex: 0,
          parallelIndex: 0,
          startTime: new Date().getTime(),
        }
      }
    } satisfies TeleReporterReceiverEventMap['onTestBegin'];
    const onTestEnd = {
      method: 'onTestEnd',
      params: {
        test: {
          testId,
          expectedStatus: 'passed',
          annotations: [],
          timeout: 30000
        },
        result: {
          id: testRunId,
          duration: 0,
          status: 'passed',
          errors: [],
          attachments: [{
            name: 'trace',
            path: zipPath,
            contentType: 'application/zip',
          }]
        }
      }
    } satisfies TeleReporterReceiverEventMap['onTestEnd'];
    return { suite, onTestBegin, onTestEnd };
  }));
  
  const directories = children.filter(h => h.kind === 'directory');
  const directoryEntries = await Promise.all(directories.map(d => getSuitesRecursively(fs, d)));
  return [...fileEntries, ...directoryEntries.flatMap(e => e)];
}

export async function readReport(fs: VirtualFs): Promise<TeleReporter> {
  const startTime = new Date().getTime(); 

  const config = {
    configFile: '../playwright.config.ts',
    globalTimeout: 0,
    maxFailures: 0,
    metadata: {},
    rootDir: 'tests',
    version: '1.48.2',
    workers: 1
  } satisfies JsonConfig;

  const data = await getSuitesRecursively(fs);
  const suites = data.map(d => d.suite);
  const onTestBegins = data.map(d => d.onTestBegin);
  const onTestEnds = data.map(d => d.onTestEnd);

  const project: JsonProject = {
    metadata: {},
    name: 'chromium',
    outputDir: '../test-results',
    repeatEach: 1,
    retries: 0,
    testDir: '',
    testIgnore: [],
    testMatch: [{ s: '**/*.@(spec|test).?(c|m)[jt]s?(x)' }],
    timeout: 30000,
    suites,
    grep: [{ r: { source: '.*', flags: '' } }],
    grepInvert: [],
    dependencies: [],
    snapshotDir: ''
  };

  return [
    { method: 'onConfigure', params: { config } },
    { method: 'onProject', params: { project } },
    { method: 'onBegin', params: {} },
    {
      method: 'onEnd', params: {
        result: {
          status: 'passed',
          startTime,
          duration: new Date().getTime() - startTime,
        }
      }
    },
    ...onTestBegins,
    ...onTestEnds,
  ];
}
