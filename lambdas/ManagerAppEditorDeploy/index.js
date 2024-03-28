
const AWS = require('aws-sdk');
const SSM = new AWS.SSM({ region: 'ap-northeast-1' });
const REMOTE_WORKING_DIR = '/home/ec2-user/k2deploy';
const lambda = new AWS.Lambda();

exports.handler = async (event, context) => {
	let logData = [];
	let logAccountId;

	console.log(event.headers);
	console.log(event.headers.Authorization);
	let authToken = event.headers.Authorization;
	authToken = authToken.replace(" ", "");
	if (event.pathParameters && event.pathParameters?.appId) {
		let appId = event.pathParameters.appId;

		try {
			// JSファイル
			let command = '~/.nvm/versions/node/v16.18.0/bin/node deploy.mjs ' + appId + ' ' + authToken;

			command = 'su -c "' + command + '" ec2-user';

			let params = {
				DocumentName: 'AWS-RunShellScript',
				InstanceIds: ['i-072210c20ac4a0e64'],
				Parameters: {
					commands: [command], // 配列で指定するので複数実行も出来る
					workingDirectory: [REMOTE_WORKING_DIR + '_' + process.env.ENV] // どの階層で実行するかを指定
				},
				// SSMの実行結果をCloudWatchにロギング
				CloudWatchOutputConfig: {
					CloudWatchLogGroupName: 'SSMLogs',
					CloudWatchOutputEnabled: true
				},
				// タイムアウト設定
				TimeoutSeconds: 3600 // 1 hour
			};

			const sendCommandResult = await SSM.sendCommand(params).promise();
			console.log("params", params);
			console.log("sendCommandResult", sendCommandResult);

			const response = sendCommandResult;
			// success log
			await createLog(context, 'APPデザイナー', 'デプロイ', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
			return {
				statusCode: 200,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Headers': '*',
				},
				body: JSON.stringify(response),
			};
		} catch (e) {
			console.log(e);
			// failure log
			await createLog(context, 'APPデザイナー', 'デプロイ', '失敗', '500', event.requestContext.identity.sourceIp, logAccountId, logData);
			return {
				statusCode: 500,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Headers': '*',
				},
				body: JSON.stringify(e),
			};
		}
	}
	else {
		// failure log
		await createLog(context, 'APPデザイナー', 'デプロイ', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
		return {
			statusCode: 400,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Headers': '*',
			},
			body: { "message": "AppIdを指定してください" },
		};
	}
};

async function createLog(context, _target, _type, _result, _code, ipAddress, accountId, logData = null) {
	let params = {
		FunctionName: "createLog-" + process.env.ENV,
		InvocationType: "Event",
		Payload: JSON.stringify({
			logGroupName: context.logGroupName,
			logStreamName: context.logStreamName,
			_target: _target,
			_type: _type,
			_result: _result,
			_code: _code,
			ipAddress: ipAddress,
			accountId: accountId,
			logData: logData
		}),
	};
	await lambda.invoke(params).promise();
}