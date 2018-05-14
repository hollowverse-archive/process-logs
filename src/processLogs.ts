import zlib from 'zlib';
import bluebird from 'bluebird';
import got from 'got';
import memoizePromise from 'p-memoize';
import { globalAgent as globalHttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { readAwsSecretStringForStage } from '@hollowverse/utils/helpers/readAwsSecretStringForStage';

const gunzip = bluebird.promisify<Buffer, zlib.InputType>(zlib.gunzip);

const COLLECTOR_URL =
  'https://input-prd-p-kwnk36xd58jf.cloud.splunk.com:8088/services/collector/event';

const getSplunkToken = memoizePromise(async () =>
  readAwsSecretStringForStage('splunk/httpCollector/awsLogs/token'),
);

export const processLogs: AWSLambda.CloudWatchLogsHandler = async ({
  awslogs: { data },
}) => {
  // CloudWatch Logs data is base64 encoded so decode here
  const decoded = Buffer.from(data, 'base64');

  // CloudWatch Logs are gzip compressed so expand here
  const uncompressed = await gunzip(decoded);

  const { logEvents }: AWSLambda.CloudWatchLogsDecodedData = JSON.parse(
    uncompressed.toString('ascii'),
  );

  const transformedEvents = logEvents.map(event => ({
    event,
    host: 'AwsLogs',
    source: 'processLogs',
  }));

  if (process.env.STAGE !== 'production') {
    console.log(transformedEvents);

    return;
  }

  const token = await getSplunkToken();

  await got.post(COLLECTOR_URL, {
    body: transformedEvents.map(event => JSON.stringify(event)).join(''),
    agent: {
      http: globalHttpAgent,
      https: new HttpsAgent({
        rejectUnauthorized: false,
      }),
    },
    headers: {
      Authorization: `Splunk ${token}`,
    },
  });
};
