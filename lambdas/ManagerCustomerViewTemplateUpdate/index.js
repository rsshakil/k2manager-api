/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCustomerViewTemplateUpdate.
 * 
 * @param {*} event
 * @returns {json} response
 */
exports.handler = async (event, context) => {
    console.log("Event data:", event);
    let logData = [];
    let logAccountId;
    // Reading encrypted environment variables --- required
    if (process.env.DBINFO == null) {
        const ssmreq = {
            Name: 'DBINFO_' + process.env.ENV,
            WithDecryption: true,
        };
        const ssmparam = await ssm.getParameter(ssmreq).promise();
        const dbinfo = JSON.parse(ssmparam.Parameter.Value);
        process.env.DBWRITEENDPOINT = dbinfo.DBWRITEENDPOINT;
        process.env.DBREADENDPOINT = dbinfo.DBREADENDPOINT;
        process.env.DBUSER = dbinfo.DBUSER;
        process.env.DBPASSWORD = dbinfo.DBPASSWORD;
        process.env.DBDATABSE = dbinfo.DBDATABSE;
        process.env.DBPORT = dbinfo.DBPORT;
        process.env.DBCHARSET = dbinfo.DBCHARSET;
        process.env.DBINFO = true;
    }
    // Database info
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    };

    const {
        customerViewTemplateName,
        customerViewTemplateSearch,
        customerViewTemplateColumn,
        appId,
        customerViewTemplateCreateTemplateId,
        customerViewTemplateEditTemplateId,
        filterId,
        customerViewTemplateAuthRole,
        memo,
        updatedBy,
        projectId
    } = JSON.parse(event.body);

    if (event.pathParameters?.customerViewTemplateId) {
        let customerViewTemplateId = event.pathParameters.customerViewTemplateId;
        console.log("customerViewTemplateId:", customerViewTemplateId);
        logAccountId = updatedBy;
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                // failure log
                await createLog(context, '顧客一覧テンプレート', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                };
            }
        }

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // beforeDataの作成
            let beforeSql = `SELECT * FROM CustomerViewTemplate WHERE customerViewTemplateId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [customerViewTemplateId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
                await createLog(context, '顧客一覧テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Found set already deleted",
                        errorCode: 201
                    }),
                };
            }

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = projectId;
            logData[0].afterValue = projectId;
            logData[1] = {};
            logData[1].fieldName = "顧客一覧テンプレート名";
            logData[1].beforeValue = beforeResult[0].customerViewTemplateName;
            logData[1].afterValue = customerViewTemplateName;
            logData[2] = {};
            logData[2].fieldName = "顧客一覧テンプレート検索フィルター";
            logData[2].beforeValue = beforeResult[0].customerViewTemplateSearch;
            logData[2].afterValue = customerViewTemplateSearch;
            logData[3] = {};
            logData[3].fieldName = "顧客一覧テンプレート表示フィールド";
            logData[3].beforeValue = beforeResult[0].customerViewTemplateColumn;
            logData[3].afterValue = customerViewTemplateColumn;
            logData[4] = {};
            logData[4].fieldName = "予約APPID";
            logData[4].beforeValue = beforeResult[0].appId;
            logData[4].afterValue = appId;
            logData[5] = {};
            logData[5].fieldName = "表示情報フィルター";
            logData[5].beforeValue = beforeResult[0].filterId;
            logData[5].afterValue = filterId;
            logData[6] = {};
            logData[6].fieldName = "このテンプレートを利用可能なロール";
            logData[6].beforeValue = beforeResult[0].customerViewTemplateAuthRole;
            logData[6].afterValue = customerViewTemplateAuthRole;
            logData[7] = {};
            logData[7].fieldName = "メモ";
            logData[7].beforeValue = beforeResult[0].memo;
            logData[7].afterValue = memo;

            // START =============== make select query
            let customerViewTemplateQuery = 'Customer.*,Reservation.*';
            let customerViewTemplateMaskQuery = "";
            let customerViewTemplateOrder = "";
            let customerViewTemplateFrom = "";
            let customerViewTemplateListData = [];

            console.log("customerViewTemplateColumn", JSON.stringify(customerViewTemplateColumn));
            if (customerViewTemplateColumn && customerViewTemplateColumn.length > 0) {
                let fieldIdArrays = customerViewTemplateColumn.map(item => {
                    if (item.customerTemplate != null) {
                        return {
                            position: item.currentPos,
                            fieldId: (item?.customerTemplate?.fieldType == "") ? 0 : item?.customerTemplate?.fieldType,
                            mask: (item?.customerTemplate?.mask_state == "true") ? true : false
                        };
                    }
                });
                fieldIdArrays = fieldIdArrays.filter(function (el) {
                    return el != null;
                });
                console.log("fieldIdArrays", JSON.stringify(fieldIdArrays));

                if (fieldIdArrays.length > 0) {
                    fieldIdArrays.sort((a, b) => (a.position > b.position ? 1 : -1));
                    let fieldIdArray = fieldIdArrays.map(item => {
                        if (item.fieldId > 0) {
                            return item.fieldId;
                        }
                    });
                    let fieldQueryParam = [];
                    //get field list
                    const sql_data_fields = `SELECT * FROM Field WHERE 1=1 AND fieldId IN (?) AND (projectId = 0 OR projectId = ?) ORDER BY Field.fieldId ASC`;
                    fieldQueryParam.push(fieldIdArray);
                    fieldQueryParam.push(Number(projectId));
                    let [query_result_field_name] = await mysql_con.query(sql_data_fields, fieldQueryParam);
                    console.log("fieldIdArrays", JSON.stringify(fieldIdArrays));
                    let templatefieldList = query_result_field_name;
                    let numOfField = 1;
                    let nameAlias = 0;
                    console.log("templatefieldList", JSON.stringify(templatefieldList));
                    let fieldIdArrayList = fieldIdArrays.map(item => {

                        // let row = templatefieldList.find(fieldRow => fieldRow.fieldId == item.fieldId);
                        let row = {};
                        let row2 = templatefieldList.find(fieldRow => fieldRow.fieldId == item.fieldId);
                        if (typeof row2 == 'undefined') {
                            row.fieldColumnName = `null AS s${nameAlias}`;
                        } else {
                            row = Object.assign({}, row2);

                            if (row.projectId != 0) {
                                let fName = '';
                                switch (row.fieldType) {
                                    case 0:
                                    case 1:
                                    case 2:
                                        //text
                                        fName = 'customerFieldText';
                                        row.fieldColumnName = `f${numOfField}.${fName} AS s${nameAlias}`;
                                        break;
                                    case 3:
                                        //list
                                        fName = 'customerFieldList';
                                        row.fieldColumnName = `f${numOfField}.${fName} AS s${nameAlias}`;
                                        customerViewTemplateListData.push({
                                            fieldCode: row.fieldCode,
                                            numOfField: 's' + nameAlias
                                        })
                                        break;
                                    case 4:
                                        //bool
                                        fName = 'customerFieldBoolean';
                                        row.fieldColumnName = `CASE WHEN f${numOfField}.${fName} is null then '' WHEN f${numOfField}.${fName} = 1 THEN '${row.fieldStyle.trueText}' ELSE '${row.fieldStyle.falseText}' END AS s${nameAlias}`;
                                        break;
                                    case 5:
                                        fName = 'customerFieldInt';
                                        // row.fieldColumnName = `DATE_FORMAT(from_unixtime(f${numOfField}.${fName}), '%Y/%m/%d') AS s${nameAlias}`;
                                        row.fieldColumnName = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL f${numOfField}.${fName} SECOND), '%Y/%m/%d') AS s${nameAlias}`;
                                        break;
                                    case 6:
                                        fName = 'customerFieldInt';
                                        row.fieldColumnName = `CASE WHEN f${numOfField}.${fName} = 0 THEN '' ELSE CONCAT(SUBSTRING(LPAD(f${numOfField}.${fName}, 4, '0'), 1, 2), ':', SUBSTRING(LPAD(f${numOfField}.${fName}, 4, '0'), 3, 2)) END AS s${nameAlias}`;
                                        break;
                                    case 7:
                                        //int
                                        fName = 'customerFieldInt';
                                        row.fieldColumnName = `FORMAT(f${numOfField}.${fName}, 0) AS s${nameAlias}`;
                                        break;
                                }
                                // customerViewTemplateFrom += ` LEFT OUTER JOIN CustomerField AS f${numOfField} ON Customer.customerId = f${numOfField}.customerId AND f${numOfField}.fieldId = ${row.fieldId} AND Reservation.reservationNo = f${numOfField}.reservationNo`;
                                customerViewTemplateFrom += ` LEFT OUTER JOIN CustomerField AS f${numOfField} ON Customer.customerId = f${numOfField}.customerId AND f${numOfField}.fieldId = ${row.fieldId} AND (CASE WHEN Reservation.reservationNo IS NULL THEN '' ELSE Reservation.reservationNo END) = f${numOfField}.reservationNo`;
                                numOfField++;
                            }
                            else {
                                //activity for project id is 0
                                switch (row.fieldType) {
                                    case 0:
                                    case 1:
                                    case 2:
                                        row.fieldColumnName = `${row.fieldColumnName} AS s${nameAlias}`;
                                        // console.log('colName',`${row.fieldColumnName} AS s${nameAlias}`);
                                        break;
                                    case 3:
                                        /*
                                                                                let allCondition = '';
                                                                                row?.fieldStyle?.lookup?.map(item => {
                                        console.log("ITEMMMMMM", item);
                                                                                    allCondition += `WHEN ${row.fieldColumnName} = '${item.fieldListCode}' THEN '${item.inputBox2.value}' `;
                                                                                });
                                                                                console.log("getFieldType3SearchColumns", allCondition);
                                                                                if (allCondition != '') {
                                                                                    // row.fieldColumnName = `CASE ${allCondition} ELSE '' END AS ${row.fieldColumnName.split('.')[1]}`;
                                                                                    row.fieldColumnName = `CASE ${allCondition} ELSE '' END AS s${nameAlias}`;
                                                                                }else{
                                                                                    row.fieldColumnName = `${row.fieldColumnName} AS s${nameAlias}`;
                                                                                }
                                        */
                                        // 作り直し
                                        row.fieldColumnName = `${row.fieldColumnName} AS s${nameAlias}`;
                                        customerViewTemplateListData.push({
                                            fieldCode: row.fieldCode,
                                            numOfField: 's' + nameAlias
                                        })
                                        break;
                                    case 4:
                                        // row.fieldColumnName = `CASE WHEN ${row.fieldColumnName} is null then '' WHEN ${row.fieldColumnName} = 1 THEN '${row.fieldStyle.trueText}' ELSE '${row.fieldStyle.falseText}' END AS ${row.fieldColumnName.split('.')[1]}`;
                                        row.fieldColumnName = `CASE WHEN ${row.fieldColumnName} is null then '' WHEN ${row.fieldColumnName} = 1 THEN '${row.fieldStyle.trueText}' ELSE '${row.fieldStyle.falseText}' END AS s${nameAlias}`;
                                        break;
                                    case 5:
                                        // row.fieldColumnName = `DATE_FORMAT(from_unixtime(${row.fieldColumnName}), '%Y/%m/%d') AS ${row.fieldColumnName.split('.')[1]}`;
                                        // row.fieldColumnName = `DATE_FORMAT(from_unixtime(${row.fieldColumnName}), '%Y/%m/%d') AS s${nameAlias}`;//last
                                        row.fieldColumnName = `DATE_FORMAT(DATE_ADD(FROM_UNIXTIME(0), INTERVAL ${row.fieldColumnName} SECOND), '%Y/%m/%d') AS s${nameAlias}`;
                                        break;
                                    case 6:
                                        // row.fieldColumnName = `CASE WHEN ${row.fieldColumnName} = 0 THEN '' ELSE CONCAT(SUBSTRING(LPAD(${row.fieldColumnName}, 4, '0'), 1, 2), ':', SUBSTRING(LPAD(${row.fieldColumnName}, 4, '0'), 3, 2)) END AS ${row.fieldColumnName.split('.')[1]}`;
                                        row.fieldColumnName = `CASE WHEN ${row.fieldColumnName} = 0 THEN '' ELSE CONCAT(SUBSTRING(LPAD(${row.fieldColumnName}, 4, '0'), 1, 2), ':', SUBSTRING(LPAD(${row.fieldColumnName}, 4, '0'), 3, 2)) END AS s${nameAlias}`;
                                        break;
                                    case 7:
                                        // row.fieldColumnName = `FORMAT(${row.fieldColumnName}, 0) AS ${row.fieldColumnName.split('.')[1]}`;
                                        row.fieldColumnName = `FORMAT(${row.fieldColumnName}, 0) AS s${nameAlias}`;
                                        break;
                                    case 9:
                                        row.fieldColumnName = `null AS s${nameAlias}`;
                                        break;
                                }
                            }

                        }
                        row.mask = item?.mask;
                        nameAlias++;
                        return row;

                    });
                    let fieldNameArray = fieldIdArrayList.map(item => {
                        // return item.fieldColumnName ?? "'フィールドが見つかりません'"
                        console.log('fieldColumnName', item?.fieldColumnName);
                        if (item?.fieldColumnName) {
                            return item?.fieldColumnName;
                        }
                    }).filter(e => typeof e !== 'undefined');
                    let fieldNameArray2 = fieldIdArrayList.map(item => {
                        // console.log("item", JSON.stringify(item));
                        // console.log("item2", item.fieldColumnName.split(" AS "));
                        if (item?.mask) {
                            return `'*****' AS ${item.fieldColumnName.split(" AS ")[1]}`;
                        }
                        else if (item?.fieldColumnName) {
                            return item?.fieldColumnName;
                        }
                    }).filter(e => typeof e !== 'undefined');
                    console.log("fieldNameArray", fieldNameArray);
                    console.log("fieldNameArray2", fieldNameArray2);

                    /*sortImplemented*/
                    let sortFieldIdArrays = customerViewTemplateColumn.filter(item => {
                        if (item.customerTemplate != null && !isNaN(item.customerTemplate.sort_priority) && item.customerTemplate.sort_priority != '' && item.customerTemplate.fieldType > 0) {
                            return true;
                        }
                    });
                    if (sortFieldIdArrays.length > 0) {
                        sortFieldIdArrays = sortFieldIdArrays.map(item => {
                            return {
                                pos: item.customerTemplate.sort_priority,
                                fieldId: item.customerTemplate.fieldType,
                                orderType: item.customerTemplate.ascending_order
                            };
                        });

                        // console.log("22222222", JSON.stringify(sortFieldIdArrays));
                        sortFieldIdArrays.sort((a, b) => (a.pos > b.pos ? 1 : -1));

                        let sortFieldIdArray = sortFieldIdArrays.map(item => {
                            if (item.fieldId > 0) {
                                return item.fieldId;
                            }
                        });

                        let fieldQueryParam2 = [];
                        //get field list
                        const sql_data_fields2 = `SELECT * FROM Field WHERE 1=1 AND fieldId IN (?) AND (projectId = 0 OR projectId = ?) ORDER BY Field.fieldId ASC`;
                        fieldQueryParam2.push(sortFieldIdArray);
                        fieldQueryParam2.push(Number(projectId));
                        let [query_result_field_name2] = await mysql_con.query(sql_data_fields2, fieldQueryParam2);
                        console.log("sortFieldIdArrays", JSON.stringify(sortFieldIdArrays));
                        let templatefieldList2 = query_result_field_name2;
                        let fieldIdArrayList2 = sortFieldIdArrays.map(item => {
                            let row = templatefieldList2.find(fieldRow => fieldRow.fieldId == item.fieldId);
                            return `${row.fieldColumnName} ${item.orderType}`;
                        });
                        console.log("sortFieldIdArraysValues", JSON.stringify(fieldIdArrayList2));

                        /*sortImplemented*/
                        customerViewTemplateOrder = fieldIdArrayList2.join(', ');
                    }
                    customerViewTemplateQuery = fieldNameArray.join(', ');
                    customerViewTemplateMaskQuery = fieldNameArray2.join(', ');
                }//field specify end
            }//condition end here
            console.log("customerViewTemplateQuery", customerViewTemplateQuery);
            console.log("customerViewTemplateMaskQuery", customerViewTemplateMaskQuery);
            console.log("customerViewTemplateOrder", customerViewTemplateOrder);

            // END =============== make select query

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_data = `UPDATE CustomerViewTemplate SET 
                customerViewTemplateName = ?,
                customerViewTemplateSearch = ?,
                customerViewTemplateColumn = ?,
                customerViewTemplateQuery = ?,
                customerViewTemplateMaskQuery = ?,
                customerViewTemplateOrder = ?,
                customerViewTemplateFrom = ?,   
                customerViewTemplateListData = ?,
                appId = ?,
                customerViewTemplateCreateTemplateId = ?,
                customerViewTemplateEditTemplateId = ?,
                filterId = ?,
                customerViewTemplateAuthRole = ?,
                memo = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE customerViewTemplateId = ?;`;
            let sql_param = [
                customerViewTemplateName,
                customerViewTemplateSearch,
                customerViewTemplateColumn,
                customerViewTemplateQuery,
                customerViewTemplateMaskQuery,
                customerViewTemplateOrder,
                customerViewTemplateFrom,
                customerViewTemplateListData,
                appId,
                customerViewTemplateCreateTemplateId,
                customerViewTemplateEditTemplateId,
                filterId,
                customerViewTemplateAuthRole,
                memo,
                updatedAt,
                updatedBy,
                customerViewTemplateId,
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            if (query_result.length === 0) {
                // failure log
                await createLog(context, '顧客一覧テンプレート', '更新', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 404,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "no data"
                    }),
                };
            }
            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, '顧客一覧テンプレート', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify(response),
            };
        } catch (error) {
            await mysql_con.rollback();
            console.log(error);
            // failure log
            await createLog(context, '顧客一覧テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify(error),
            };
        } finally {
            if (mysql_con) await mysql_con.close();
        }
    } else {
        // failure log
        await createLog(context, '顧客一覧テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({
                "message": "invalid parameter"
            }),
        };
    }
};
async function createLog(context, _target, _type, _result, _code, ipAddress, projectId, accountId, logData = null) {
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
            projectId: projectId,
            accountId: accountId,
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}

