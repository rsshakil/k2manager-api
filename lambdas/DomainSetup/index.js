// この関数では、カスタムドメインをテンポラリーCloudfrontに向ける処理を行っています。
// 管理画面のドメイン追加処理の延長で呼ばれる想定です。
// ひとつテンポラリCloudfrontを、事前に準備していて、それをここで利用します。
// テンポラリCloudfrontでは、「工事中」だけを表示するhtmlを置いています。
// この関数では、デプロイの完了を待たないので、関数復帰から数分後変更が反映されます。
//
// 方針変更
// カスタムドメインを127.0.0.1に向けるように処理を変更します。
//
// パラメータ：
/*
{
    "customDomain": "example.k2-system.net"
}
*/

const AWS = require("aws-sdk");

// const targetDomain = "d204a80m7uohz6.cloudfront.net"; // テンポラリCloudfrontドメイン
// const targetCFId = "E139MW7WREKNW6"; // テンポラリCloudfrontのID
// const HZIdcloudfront = "Z2FDTNDATAQYW2"; // CloudfrontのHostedZoneID
// const HZIdRoute53 = "Z07544713J9OYIECV3DZF"; // k2-system.netのHostedZoneID

exports.handler = async (event) => {
    console.log("event: ", event);
    const customDomain = event.customDomain;
    const action = event.action;
    var status;
    var message;

    try {
        await setupRoute53(customDomain, action);
        // await setupCloudfront(customDomain);

        status = 200;
        message = "success";
    }
    catch (error) {
        console.log("error: ", error);
        status = 500;
        message = error.message;
    }

    // レスポンスを返します。
    //
    const response = {
        statusCode: status,
        body: JSON.stringify(message),
    };
    return response;
};

/**
 * 該当ドメインから、Route53のHosted Zoneを特定する
 */
async function getHZRoute53(customDomain)
{
    // フルドメインからサブドメイン部分を削除
    // 例： example.k2-system.net → k2-system.net
    //
    let domain = customDomain.replace(/^[^.]+\./g, "");

    // Route53に渡すためのパラメータです。
    //
    const params = {
        DNSName: domain,
        MaxItems: "1"
    };
    console.log("params: ");
    console.dir(params, { depth: null });

    console.log("going to listHostedZonesByName");
    const route53 = new AWS.Route53();
    const res = await route53.listHostedZonesByName(params).promise();
    console.log("Route53 response: ", res);

    // 指定ドメインにマッチしなくてもレコードが返ってくるというダメな仕様なので、以下のチェックが必要
    // また、返ってくるドメイン名の最後にドットが付いてくるので、その削除が必要
    //
    const foundDomain = res.HostedZones[0].Name.replace(/\.$/, '');
    if (foundDomain != domain) {
        console.log("specified domain: ", domain);
        console.log("found domain: ", foundDomain);
        throw new Error("Hosted zone not found");
    }

    let hzId = res.HostedZones[0].Id.split("/")[2];
    console.log("hzId: ", hzId);

    return hzId;
}

/**
 * Route53で、該当ドメインのAレコードを追加する
 */
async function setupRoute53(customDomain, action)
{
    const hzId = await getHZRoute53(customDomain);
    console.log("hzId: ", hzId);

    if (!hzId) {
        throw new Error("Hosted zone not found");
    }

    // Route53に渡すためのパラメータです。
    //
    const paramsRoute53 = {
        ChangeBatch: {
            Changes: [{
                Action: action,
                ResourceRecordSet: {
                    "Name": customDomain,
                    "Type": "A",
                    // "AliasTarget": {
                    //     "HostedZoneId": HZIdcloudfront,
                    //     "DNSName": targetDomain,
                    //     "EvaluateTargetHealth": false
                    // }
                    "TTL": 300,
                    "ResourceRecords": [
                        {
                            "Value": "127.0.0.1"
                        }
                    ]
                }
            }],
            Comment: "generated from lambda"
        },
        HostedZoneId: hzId
    };
    console.log("paramsRoute53: ");
    console.dir(paramsRoute53, { depth: null });

    // Route53で、レコードを追加します。
    // 既にあれば、更新されます。
    //
    console.log("going to change Route53 record");
    const route53 = new AWS.Route53();
    const resRoute53 = await route53.changeResourceRecordSets(paramsRoute53).promise();
    console.log("Route53 response: ", resRoute53);
}

/**
 * Cloudfrontで、該当ドメインのaliasを追加する
 */
/*
async function setupCloudfront(customDomain)
{
    // Cloudfrontの情報も更新する必要があるので、それに向けて、オブジェクトを取得します。
    //
    console.log("going to get cloudfront object");
    const cloudfront = new AWS.CloudFront();

    // Cloudfrontの情報を更新するためには、先ずは、既存の情報を取得する必要があるので、そうします。
    //
    const paramsGetCF = {
        Id: targetCFId
    };
    console.log("paramsGetCF: ", paramsGetCF);
    console.log("going to get cloudfront");
    const configCF = await cloudfront.getDistributionConfig(paramsGetCF).promise();
    //console.log("configCF: ");
    //console.dir(configCF, { depth: null });

    // Cloudfrontを更新するためのパラメータを準備します。
    // 既に紐づいているaliasに、今回のものを追加するようにしています。
    //
    configCF.DistributionConfig.Aliases.Quantity += 1;
    configCF.DistributionConfig.Aliases.Items.push(customDomain);
    const configCFNew = {
        Id: targetCFId,
        IfMatch: configCF.ETag,
        DistributionConfig: configCF.DistributionConfig
    }
    //console.log("configCFNew: ");
    //console.dir(configCFNew, { depth: null });

    // Cloudfrontを更新します。
    //
    console.log("going to update cloudfront");
    const CFNew = await cloudfront.updateDistribution(configCFNew).promise();
    console.log("CFNew: ");
    console.dir(CFNew, { depth: null });
}
*/
