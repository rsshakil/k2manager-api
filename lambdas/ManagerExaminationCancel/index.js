/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerExaminationCancel.
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

    // Expand GET parameters
    let jsonBody = JSON.parse(event.body);
    logAccountId = jsonBody.deletedBy;
    let projectId = 0;
    if (jsonBody?.pid) {
        projectId = jsonBody.pid;
    } else {
        let error = "invalid parameter. Project ID not found.";
        // failure log
        await createLog(context, '検診予約', 'キャンセル', '失敗', '400', event.requestContext.identity.sourceIp, null, logAccountId, null, null, logData);
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        };
    }

    let validProjectId;
    if (event?.requestContext?.authorizer?.pid) {
        validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
        // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
        if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
            // failure log
            await createLog(context, '検診予約', 'キャンセル', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, null, null, logData);
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
        mysql_con = await mysql.createConnection(writeDbConfig);
        mysql_con.beginTransaction();
        const reservationId = event.pathParameters.reservationId;
        const customerId = Number.parseInt(event.queryStringParameters.cid, 10);
        const changer = (JSON.parse(event.body)?.changer) ? JSON.parse(event.body).changer : "本人";
        console.log("reservationId = " + reservationId);
        console.log("customerId = " + customerId);
        // 予約データがある
        let sql_reservation = `SELECT * FROM Reservation WHERE reservationId = ? AND customerId = ? AND reservationStatus = 1`;
        var [result] = await mysql_con.execute(sql_reservation, [reservationId, customerId]);
        let sql_customer = `SELECT * FROM Customer WHERE customerId = ?`;
        var [result_customer] = await mysql_con.execute(sql_customer, [customerId]);
        if (result.length >= 1 && result[0].reservationStatus == 1) {
            // ログデータ作成
            logData = await makeLogData(result[0], result_customer[0]);
            console.log("キャンセル処理開始 -2");
            let reservationNo = result[0].reservationNo;
            let sql_data = `UPDATE Reservation SET reservationStatus = 0, updatedAt = ?, updatedBy = ?, cancelDatetime = ? WHERE reservationNo = ? AND customerId = ? AND reservationStatus = 1`;
            var [query_result] = await mysql_con.execute(sql_data, [
                Math.floor(new Date().getTime() / 1000),
                changer,
                Math.floor(new Date().getTime() / 1000),
                reservationNo,
                customerId,
            ]);
            if (query_result.affectedRows === 0) {
                // failure log
                await createLog(context, '検診予約', 'キャンセル', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, eventId, customerId, logData);
                return {
                    statusCode: 404,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify({ message: 'no data' }),
                };
            }

            // ReservationSlotのステータスを無効にし枠を減らす処理
            // let get_reservation_id_query = `SELECT reservationId, reservationEventSlotId FROM Reservation WHERE reservationId = ?`;
            // var [query_result, query_field] = await mysql_con.query(get_reservation_id_query, [reservationNo]);
            // let reservationId = query_result[0].reservationId;
            let baseSlotId = result[0].reservationEventSlotId;

            console.log("=======================--");
            console.log("reservationId =" + reservationId);
            console.log("slotId =" + baseSlotId);

            // 予約したアイテム枠の予約数を減らす
            let get_reservation_slot = `SELECT * FROM ReservationSlot WHERE reservationId = ? AND reservationStatus = 1`;
            var [query_result2] = await mysql_con.query(get_reservation_slot, [reservationId]);
            console.log("length === " + query_result2.length);
            for (let i = 0; i < query_result2.length; i++) {
                // let row = query_result2[i];
                let slotId = query_result2[i].slotId;
                // 同じmappingidかつ同じdatetimeかつ同じitemIdだった場合更新する
                let sql_select_mapping_info = `SELECT mappingId, datetime, itemId, itemSubId, counselorId, counselorSubId FROM EventSlot WHERE slotId = ?`;
                let [mapping_result] = await mysql_con.execute(sql_select_mapping_info, [slotId]);
                let slot_mappingId = mapping_result[0].mappingId;
                let slot_datetime = mapping_result[0].datetime;
                let slot_itemId = mapping_result[0].itemId;
                let slot_itemSubId = mapping_result[0].itemSubId;
                let slot_counselorId = mapping_result[0].counselorId;
                let slot_counselorSubId = mapping_result[0].counselorSubId;
                // 更新
                let update_result
                if (slot_itemId) {
                    let sql_update_eventslot_option = `UPDATE EventSlot SET commonReservationCount = commonReservationCount - 1, reservationCount = reservationCount - 1 WHERE mappingId = ? AND datetime = ? AND itemId = ? AND itemSubId = ?`;
                    // let update_slot = `UPDATE EventSlot SET reservationCount = reservationCount - 1 WHERE slotId = ?`;
                    [update_result] = await mysql_con.execute(sql_update_eventslot_option, [slot_mappingId, slot_datetime, slot_itemId, slot_itemSubId]);
                }
                else {
                    let sql_update_eventslot_option = `UPDATE EventSlot SET commonReservationCount = commonReservationCount - 1, reservationCount = reservationCount - 1 WHERE mappingId = ? AND datetime = ? AND counselorId = ? AND counselorSubId = ?`;
                    // let update_slot = `UPDATE EventSlot SET reservationCount = reservationCount - 1 WHERE slotId = ?`;
                    [update_result] = await mysql_con.execute(sql_update_eventslot_option, [slot_mappingId, slot_datetime, slot_counselorId, slot_counselorSubId]);
                }
                if (update_result.affectedRows === 0) {
                    console.error("sql_update_eventslot_option", sql_update_eventslot_option);
                    console.error("slot_mappingId", slot_mappingId);
                    console.error("slot_datetime", slot_datetime);
                    console.error("slot_itemId", slot_itemId);
                    console.error("slot_itemSubId", slot_itemSubId);
                    throw (400, "slot update error");
                }
                // チェイン情報を確認し、あった場合関連するアイテム枠の予約数を減らす
                let sql_chain_get = `SELECT
                    chainItemId, chainCounselorId, EventSlot.mappingId, datetime 
                    FROM EventSlot 
                    LEFT OUTER JOIN EventSubItem ON
                        EventSlot.mappingId = EventSubItem.mappingId AND
                        EventSlot.itemId = EventSubItem.itemId AND
                        EventSlot.itemSubId = EventSubItem.itemSubId
                    LEFT OUTER JOIN EventSubCounselor ON
                        EventSlot.mappingId = EventSubCounselor.mappingId AND
                        EventSlot.counselorId = EventSubCounselor.counselorId AND
                        EventSlot.counselorSubId = EventSubCounselor.counselorSubId
                    WHERE EventSlot.slotId = ?`;
                console.log("chainData slotId", slotId);
                let [chainData] = await mysql_con.execute(sql_chain_get, [slotId]);
                if (chainData && chainData.length >= 1) {
                    let chainItemCounselor = (chainData[0].chainItemId) ? chainData[0].chainItemId : chainData[0].chainCounselorId
                    console.log("chainData", chainData);
                    let chainDataSplits = String(chainItemCounselor).split(',');
                    let chainMappingId = chainData[0].mappingId;
                    let chainDatetime = chainData[0].datetime;
                    for (let j = 0; j < chainDataSplits.length; j++) {
                        let chainItemId = chainDataSplits[j].split(':')[0];
                        if (chainItemId) {
                            let chainItemSubId = chainDataSplits[j].split(':')[1];
                            let chain_sql;
                            if (chainData[0].chainItemId) {
                                chain_sql = `UPDATE EventSlot
                                    SET commonReservationCount = commonReservationCount - 1
                                    WHERE itemId = ? AND itemSubId = ? AND mappingId = ? AND datetime = ?`;
                            }
                            else {
                                chain_sql = `UPDATE EventSlot
                                    SET commonReservationCount = commonReservationCount - 1
                                    WHERE counselorId = ? AND counselorSubId = ? AND mappingId = ? AND datetime = ?`;
                            }
                            console.log("chain chainItemId", chainItemId);
                            console.log("chain chainItemSubId", chainItemSubId);
                            console.log("chain chainMappingId", chainMappingId);
                            console.log("chain chainDatetime", chainDatetime);
                            let [uCnt2] = await mysql_con.execute(chain_sql, [chainItemId, chainItemSubId, chainMappingId, chainDatetime]);
                            if (uCnt2.changedRows == 0) {
                                throw (400, "chain data eventslot capacity error!");
                            }
                        }
                    }
                }
            }
            // 予約したアイテム情報を無効にする
            let update_reservation_slot = `UPDATE ReservationSlot SET reservationStatus = 0 WHERE reservationId = ?`;
            var [update_result3] = await mysql_con.execute(update_reservation_slot, [reservationId]);
            if (update_result3.affectedRows === 0) {
                throw (400, "reservation slot update error");
            }
            // 施設基本枠も減らす
            let update_base_slot = `UPDATE EventSlot SET commonReservationCount = commonReservationCount - 1, reservationCount = reservationCount - 1 WHERE slotId = ?`;
            // let update_base_slot = `UPDATE EventSlot SET reservationCount = reservationCount - 1 WHERE slotId = ?`;
            var [update_result4] = await mysql_con.execute(update_base_slot, [baseSlotId]);
            if (update_result4.affectedRows === 0) {
                throw (400, "base slot update error");
            }
            // バスの定員数も減らす
            if (result[0].reservationEventBusId !== undefined && result[0].reservationEventBusId >= 1) {
                console.log("reservationEventBusId", result[0].reservationEventBusId);
                let sql_update_eventbusway = `UPDATE EventBus AS EB INNER JOIN BusWay ON EB.busWayId = BusWay.busWayId
                SET busReservationCount = busReservationCount - 1 
                WHERE busReservationCount > 0 AND  EB.eventBusId = ?`;
                let [uCnt] = await mysql_con.execute(sql_update_eventbusway, [result[0].reservationEventBusId]);
                if (uCnt.affectedRows == 0) {
                    // throw (400, "busway update failure!");
                    // failure log
                    await createLog(context, '検診予約', 'キャンセル', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, eventId, null, logData);
                    await mysql_con.rollback();
                    return {
                        statusCode: 400,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': '*',
                        },
                        body: JSON.stringify({
                            message:  "busway update failure!",
                            errorCode: 201
                        }),
                    };
                }
            }



            let event_sql = `SELECT 
                Event.eventMailFlag, EventCategory.eventId AS eventId,EventCategory.eventCategoryId AS eventCategoryId,
                f1.fieldCode AS field1Code, f2.fieldCode AS field2Code, f3.fieldCode AS field3Code
                FROM Event
                LEFT OUTER JOIN EventCategory ON Event.eventId = EventCategory.eventId
                LEFT OUTER JOIN EventInstitute ON EventCategory.eventCategoryId = EventInstitute.eventCategoryId
                LEFT OUTER JOIN EventMapping ON EventInstitute.eventInstituteId = EventMapping.eventInstituteId
                LEFT OUTER JOIN EventSlot ON EventMapping.mappingId = EventSlot.mappingId
                LEFT OUTER JOIN Field AS f1 ON Event.token1FieldId = f1.fieldId
                LEFT OUTER JOIN Field AS f2 ON Event.token2FieldId = f2.fieldId
                LEFT OUTER JOIN Field AS f3 ON Event.token3FieldId = f3.fieldId
                WHERE slotId = ?`;
            var [event_result] = await mysql_con.query(event_sql, [baseSlotId]);
            // イベントのキャンセル枠を増やす
            const eventId = event_result[0].eventId;
            const eventCategoryId = event_result[0].eventCategoryId;
            // イベントデータの更新
            let event_query = `UPDATE Event SET cancelUserCount = cancelUserCount + 1 WHERE eventId = ?`;
            let [eCnt] = await mysql_con.execute(event_query, [eventId]);

            // 予約番号をトークンに利用していた場合ここでトークン情報を空にする
            const field1Code = event_result[0].field1Code;
            const field2Code = event_result[0].field2Code;
            const field3Code = event_result[0].field3Code;
            if (field1Code != "" && field1Code == "reservationNo") {
                let tokenUpdate = `UPDATE Customer SET token1 = '' WHERE customerId = ?`;
                await mysql_con.execute(tokenUpdate, [customerId]);
            }
            if (field2Code != "" && field2Code == "reservationNo") {
                let tokenUpdate = `UPDATE Customer SET token2 = '' WHERE customerId = ?`;
                await mysql_con.execute(tokenUpdate, [customerId]);
            }
            if (field3Code != "" && field3Code == "reservationNo") {
                let tokenUpdate = `UPDATE Customer SET token3 = '' WHERE customerId = ?`;
                await mysql_con.execute(tokenUpdate, [customerId]);
            }

            await mysql_con.commit();
            // success log
            let sql_event = `SELECT eventMailFlag FROM Event WHERE eventId = ?`;
            let [data_event] = await mysql_con.query(sql_event, [eventId]);
            const eventMailFlag = data_event[0].eventMailFlag;

            if (eventMailFlag === 1 || eventMailFlag === 3) {
                // send complete E-mail
                let params = {
                    FunctionName: "EmailSenderFunction-" + process.env.ENV,
                    InvocationType: "Event",
                    Payload: JSON.stringify({
                        "eventId": eventId,
                        "eventCategoryId": eventCategoryId,
                        "emailTemplateTypeFlag": 5,
                        "customerId": customerId,
                        "reservationNo": reservationNo
                    }),
                };
                await lambda.invoke(params).promise();
            }
            if (eventMailFlag === 2 || eventMailFlag === 3) {
                // send complete SMS
                let params = {
                    FunctionName: "SMSSenderFunction-" + process.env.ENV,
                    InvocationType: "Event",
                    Payload: JSON.stringify({
                        "eventId": eventId,
                        "eventCategoryId": eventCategoryId,
                        "smsTemplateTypeFlag": 5,
                        "customerId": customerId,
                        "reservationNo": reservationNo
                    }),
                };
                await lambda.invoke(params).promise();
            }

            // construct the response
            let response = { records: query_result[0] };
            console.log('this is response >>>>>>>>>>>>>>', response);
            // success log
            await createLog(context, '検診予約', 'キャンセル', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, eventId, customerId, logData);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        }
        else {
            // already canceled
            await mysql_con.rollback();
            console.log("すでにキャンセルされている");
            let response = {
                message: "already canceled"
            };
            // success log
            await createLog(context, '検診予約', 'キャンセル', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, null, customerId, logData);

            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        }
    } catch (error) {
        console.log(error);
        await mysql_con.rollback();
        // failure log
        await createLog(context, '検診予約', 'キャンセル', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, null, null, logData);
        let errno = error.errno;
        if (errno !== 1213) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
        // DEADLOCK
        else {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify({
                    message: error.message,
                    errorCode: 302
                }),
            };
        }
    }
    finally {
        if (mysql_con) await mysql_con.close();
    }
};
async function createLog(context, _target, _type, _result, _code, ipAddress, projectId, accountId, eventId, customerId, logData = null) {
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
            eventId: eventId,
            customerId: customerId,
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}

async function makeLogData(reservation, customer) {
    let logData = [];
    logData[0] = {};
    logData[0].fieldName = "予約ID";
    logData[0].beforeValue = reservation.reservationId;
    logData[0].afterValue = "";
    logData[1] = {};
    logData[1].fieldName = "予約者ID";
    logData[1].beforeValue = reservation.customerId;
    logData[1].afterValue = "";
    logData[2] = {};
    logData[2].fieldName = "予約番号";
    logData[2].beforeValue = reservation.reservationNo;
    logData[2].afterValue = "";
    logData[3] = {};
    logData[3].fieldName = "予約ステータス";
    logData[3].beforeValue = reservation.reservationStatus;
    logData[3].afterValue = "";
    logData[4] = {};
    logData[4].fieldName = "予約実施日時";
    logData[4].beforeValue = reservation.reservationDatetime;
    logData[4].afterValue = "";
    logData[5] = {};
    logData[5].fieldName = "予約更新日時";
    logData[5].beforeValue = reservation.updateDatetime;
    logData[5].afterValue = "";
    logData[6] = {};
    logData[6].fieldName = "予約キャンセル日時";
    logData[6].beforeValue = reservation.cancelDatetime;
    logData[6].afterValue = "";
    logData[7] = {};
    logData[7].fieldName = "予約イベント名";
    logData[7].beforeValue = reservation.reservationEventName;
    logData[7].afterValue = "";
    logData[8] = {};
    logData[8].fieldName = "予約イベントID";
    logData[8].beforeValue = reservation.reservationEventId;
    logData[8].afterValue = "";
    logData[9] = {};
    logData[9].fieldName = "予約カテゴリー名";
    logData[9].beforeValue = reservation.reservationEventCategoryName;
    logData[9].afterValue = "";
    logData[10] = {};
    logData[10].fieldName = "予約カテゴリーID";
    logData[10].beforeValue = reservation.reservationEventCategoryId;
    logData[10].afterValue = "";
    logData[11] = {};
    logData[11].fieldName = "予約施設名";
    logData[11].beforeValue = reservation.reservationEventInstituteName;
    logData[11].afterValue = "";
    logData[12] = {};
    logData[12].fieldName = "予約施設ID";
    logData[12].beforeValue = reservation.reservationEventInstituteId;
    logData[12].afterValue = "";
    logData[13] = {};
    logData[13].fieldName = "予約施設住所（結合アドレス）";
    logData[13].beforeValue = reservation.reservationEventInstituteAddress;
    logData[13].afterValue = "";
    logData[14] = {};
    logData[14].fieldName = "予約施設郵便番号";
    logData[14].beforeValue = reservation.reservationEventInstituteZipCode;
    logData[14].afterValue = "";
    logData[15] = {};
    logData[15].fieldName = "予約施設都道府県";
    logData[15].beforeValue = reservation.reservationEventInstitutePrefectureName;
    logData[15].afterValue = "";
    logData[16] = {};
    logData[16].fieldName = "予約施設電話番号";
    logData[16].beforeValue = reservation.reservationEventInstituteTelNo;
    logData[16].afterValue = "";
    logData[17] = {};
    logData[17].fieldName = "予約バスID";
    logData[17].beforeValue = reservation.reservationEventBusId;
    logData[17].afterValue = "";
    logData[18] = {};
    logData[18].fieldName = "予約バス停留所名";
    logData[18].beforeValue = reservation.reservationEventBusStopAddress;
    logData[18].afterValue = "";
    logData[19] = {};
    logData[19].fieldName = "予約バス出発時間";
    logData[19].beforeValue = reservation.reservationEventBusTime;
    logData[19].afterValue = "";
    logData[20] = {};
    logData[20].fieldName = "予約マッピングID";
    logData[20].beforeValue = reservation.reservationEventMappingId;
    logData[20].afterValue = "";
    logData[21] = {};
    logData[21].fieldName = "予約スロットID";
    logData[21].beforeValue = reservation.reservationEventSlotId;
    logData[21].afterValue = "";
    logData[22] = {};
    logData[22].fieldName = "予約検診日";
    logData[22].beforeValue = reservation.reservationReceiveDatetime;
    logData[22].afterValue = "";
    logData[23] = {};
    logData[23].fieldName = "予約検診受付開始時間";
    logData[23].beforeValue = reservation.reservationAcceptanceStartTime;
    logData[23].afterValue = "";
    logData[24] = {};
    logData[24].fieldName = "予約検診実施時間";
    logData[24].beforeValue = reservation.reservationExecutionTime;
    logData[24].afterValue = "";
    logData[25] = {};
    logData[25].fieldName = "予約した検診日の予約開始日時";
    logData[25].beforeValue = reservation.reservationStartDatetime;
    logData[25].afterValue = "";
    logData[26] = {};
    logData[26].fieldName = "予約した検診日の予約終了日時";
    logData[26].beforeValue = reservation.reservationEndDatetime;
    logData[26].afterValue = "";
    logData[27] = {};
    logData[27].fieldName = "予約健診内容（カンマ区切り）";
    logData[27].beforeValue = reservation.reservationItemContents;
    logData[27].afterValue = "";
    logData[28] = {};
    logData[28].fieldName = "予約健診内容";
    logData[28].beforeValue = reservation.reservationItem;
    logData[28].afterValue = "";
    logData[29] = {};
    logData[29].fieldName = "予約検診料金";
    logData[29].beforeValue = reservation.reservationItemCost;
    logData[29].afterValue = "";
    logData[30] = {};
    logData[30].fieldName = "予約検診アイテムスロットID";
    logData[30].beforeValue = reservation.reservationItemSlotId;
    logData[30].afterValue = "";
    logData[31] = {};
    logData[31].fieldName = "予約者名（姓）";
    logData[31].beforeValue = reservation.reservationLastName;
    logData[31].afterValue = "";
    logData[32] = {};
    logData[32].fieldName = "予約者名（名）";
    logData[32].beforeValue = reservation.reservationFirstName;
    logData[32].afterValue = "";
    logData[33] = {};
    logData[33].fieldName = "予約者名（姓名）";
    logData[33].beforeValue = reservation.reservationName;
    logData[33].afterValue = "";
    logData[34] = {};
    logData[34].fieldName = "表示のみ・予約者名結合（全角空白あり）";
    logData[34].beforeValue = reservation.reservationNameView1;
    logData[34].afterValue = "";
    logData[35] = {};
    logData[35].fieldName = "表示のみ・予約者名結合（そのまま）";
    logData[35].beforeValue = reservation.reservationNameView2;
    logData[35].afterValue = "";
    logData[36] = {};
    logData[36].fieldName = "予約者カナ名（苗字）";
    logData[36].beforeValue = reservation.reservationLastNameKana;
    logData[36].afterValue = "";
    logData[37] = {};
    logData[37].fieldName = "予約者カナ名（下の名）";
    logData[37].beforeValue = reservation.reservationFirstNameKana;
    logData[37].afterValue = "";
    logData[38] = {};
    logData[38].fieldName = "予約者カナ名前結合";
    logData[38].beforeValue = reservation.reservationNameKana;
    logData[38].afterValue = "";
    logData[39] = {};
    logData[39].fieldName = "予約者表示用カナ名前結合（全角空白あり）";
    logData[39].beforeValue = reservation.reservationNameKanaView1;
    logData[39].afterValue = "";
    logData[40] = {};
    logData[40].fieldName = "予約者表示用カナ名前結合（そのまま）";
    logData[40].beforeValue = reservation.reservationNameKanaView2;
    logData[40].afterValue = "";
    logData[41] = {};
    logData[41].fieldName = "予約者メールアドレス";
    logData[41].beforeValue = reservation.reservationEmailAddress;
    logData[41].afterValue = "";
    logData[42] = {};
    logData[42].fieldName = "予約者郵便番号（分割）";
    logData[42].beforeValue = reservation.reservationZipCode;
    logData[42].afterValue = "";
    logData[43] = {};
    logData[43].fieldName = "予約者郵便番号（8桁ハイフンあり）";
    logData[43].beforeValue = reservation.reservationZipCodeHyphen;
    logData[43].afterValue = "";
    logData[44] = {};
    logData[44].fieldName = "予約者電話番号（分割）";
    logData[44].beforeValue = reservation.reservationTelNo;
    logData[44].afterValue = "";
    logData[45] = {};
    logData[45].fieldName = "予約者電話番号（ハイフンあり）";
    logData[45].beforeValue = reservation.reservationTelNoHyphen;
    logData[45].afterValue = "";
    logData[46] = {};
    logData[46].fieldName = "予約者携帯電話番号（分割）";
    logData[46].beforeValue = reservation.reservationMobileTelNo;
    logData[46].afterValue = "";
    logData[47] = {};
    logData[47].fieldName = "予約者携帯電話番号（ハイフンあり）";
    logData[47].beforeValue = reservation.reservationMobileTelNoHyphen;
    logData[47].afterValue = "";
    logData[48] = {};
    logData[48].fieldName = "予約者FAX番号（分割）";
    logData[48].beforeValue = reservation.reservationFaxNo;
    logData[48].afterValue = "";
    logData[49] = {};
    logData[49].fieldName = "予約者FAX番号（ハイフンあり）";
    logData[49].beforeValue = reservation.reservationFaxNoHyphen;
    logData[49].afterValue = "";
    logData[50] = {};
    logData[50].fieldName = "予約者FAX番号（ハイフンなし）";
    logData[50].beforeValue = reservation.reservationFaxNo;
    logData[50].afterValue = "";
    logData[51] = {};
    logData[51].fieldName = "予約者緊急連絡先電話番号（分割）";
    logData[51].beforeValue = reservation.reservationEmergencyTelNo;
    logData[51].afterValue = "";
    logData[52] = {};
    logData[52].fieldName = "予約者緊急連絡先電話番号（ハイフンあり）";
    logData[52].beforeValue = reservation.reservationEmergencyTelNoHyphen;
    logData[52].afterValue = "";
    logData[53] = {};
    logData[53].fieldName = "予約者予備電話番号（分割）";
    logData[53].beforeValue = reservation.reservationSpareTelNo;
    logData[53].afterValue = "";
    logData[54] = {};
    logData[54].fieldName = "予約者予備電話番号（ハイフンあり）";
    logData[54].beforeValue = reservation.reservationSpareTelNoHyphen;
    logData[54].afterValue = "";
    logData[55] = {};
    logData[55].fieldName = "予約者都道府県";
    logData[55].beforeValue = reservation.reservationPrefectureName;
    logData[55].afterValue = "";
    logData[56] = {};
    logData[56].fieldName = "予約者市区町村";
    logData[56].beforeValue = reservation.reservationCityName;
    logData[56].afterValue = "";
    logData[57] = {};
    logData[57].fieldName = "予約者町名";
    logData[57].beforeValue = reservation.reservationTownName;
    logData[57].afterValue = "";
    logData[58] = {};
    logData[58].fieldName = "予約者番地";
    logData[58].beforeValue = reservation.reservationAddressName;
    logData[58].afterValue = "";
    logData[59] = {};
    logData[59].fieldName = "予約者ビル名";
    logData[59].beforeValue = reservation.reservationBuilding;
    logData[59].afterValue = "";
    logData[60] = {};
    logData[60].fieldName = "予約者住所結合（都道府県市区町村町名番地ビル名）";
    logData[60].beforeValue = reservation.reservationAddress1;
    logData[60].afterValue = "";
    logData[61] = {};
    logData[61].fieldName = "予約者住所結合（市区町村町名番地ビル名）";
    logData[61].beforeValue = reservation.reservationAddress2;
    logData[61].afterValue = "";
    logData[62] = {};
    logData[62].fieldName = "予約者住所結合（市区町村町名番地）";
    logData[62].beforeValue = reservation.reservationAddress3;
    logData[62].afterValue = "";
    logData[63] = {};
    logData[63].fieldName = "予約者都道府県カナ";
    logData[63].beforeValue = reservation.reservationPrefectureNameKana;
    logData[63].afterValue = "";
    logData[64] = {};
    logData[64].fieldName = "予約者市区町村カナ";
    logData[64].beforeValue = reservation.reservationCityNameKana;
    logData[64].afterValue = "";
    logData[65] = {};
    logData[65].fieldName = "予約者町名カナ";
    logData[65].beforeValue = reservation.reservationTownNameKana;
    logData[65].afterValue = "";
    logData[66] = {};
    logData[66].fieldName = "予約者番地カナ";
    logData[66].beforeValue = reservation.reservationAddressNameKana;
    logData[66].afterValue = "";
    logData[67] = {};
    logData[67].fieldName = "予約者ビル名カナ";
    logData[67].beforeValue = reservation.reservationBuildingKana;
    logData[67].afterValue = "";
    logData[68] = {};
    logData[68].fieldName = "予約者住所カナ結合（都道府県市区町村町名番地ビル名）";
    logData[68].beforeValue = reservation.reservationAddressKana1;
    logData[68].afterValue = "";
    logData[69] = {};
    logData[69].fieldName = "予約者住所カナ結合（市区町村町名番地ビル名）";
    logData[69].beforeValue = reservation.reservationAddressKana2;
    logData[69].afterValue = "";
    logData[70] = {};
    logData[70].fieldName = "予約者住所カナ結合（市区町村町名番地）";
    logData[70].beforeValue = reservation.reservationAddressKana3;
    logData[70].afterValue = "";
    logData[71] = {};
    logData[71].fieldName = "予約者現在日年齢";
    logData[71].beforeValue = reservation.reservationCurrentAge;
    logData[71].afterValue = "";
    logData[72] = {};
    logData[72].fieldName = "予約者実施日年齢";
    logData[72].beforeValue = reservation.reservationExaminationAge;
    logData[72].afterValue = "";
    logData[73] = {};
    logData[73].fieldName = "予約者元号年齢（偶数・奇数）";
    logData[73].beforeValue = reservation.reservationEraOddEven;
    logData[73].afterValue = "";
    logData[74] = {};
    logData[74].fieldName = "予約者年度年齢";
    logData[74].beforeValue = reservation.reservationEventAge;
    logData[74].afterValue = "";
    logData[75] = {};
    logData[75].fieldName = "予約者民法年齢";
    logData[75].beforeValue = reservation.reservationCivilLawAge;
    logData[75].afterValue = "";
    logData[76] = {};
    logData[76].fieldName = "予約者メモ";
    logData[76].beforeValue = reservation.memo;
    logData[76].afterValue = "";
    logData[77] = {};
    logData[77].fieldName = "顧客ID";
    logData[77].beforeValue = reservation.customerId;
    logData[77].afterValue = "";
    logData[78] = {};
    logData[78].fieldName = "顧客UUID";
    logData[78].beforeValue = reservation.customerUUID;
    logData[78].afterValue = "";
    logData[79] = {};
    logData[79].fieldName = "顧客システムID";
    logData[79].beforeValue = reservation.customerSystemId;
    logData[79].afterValue = "";
    logData[80] = {};
    logData[80].fieldName = "顧客その他システムID";
    logData[80].beforeValue = reservation.customerOtherSystemId;
    logData[80].afterValue = "";
    logData[81] = {};
    logData[81].fieldName = "トークン1";
    logData[81].beforeValue = reservation.token1;
    logData[81].afterValue = "";
    logData[82] = {};
    logData[82].fieldName = "トークン2";
    logData[82].beforeValue = reservation.token2;
    logData[82].afterValue = "";
    logData[83] = {};
    logData[83].fieldName = "トークン3";
    logData[83].beforeValue = reservation.token3;
    logData[83].afterValue = "";
    logData[84] = {};
    logData[84].fieldName = "氏名（姓）";
    logData[84].beforeValue = reservation.lastName;
    logData[84].afterValue = "";
    logData[85] = {};
    logData[85].fieldName = "氏名（名）";
    logData[85].beforeValue = reservation.firstName;
    logData[85].afterValue = "";
    logData[86] = {};
    logData[86].fieldName = "氏名（姓名）";
    logData[86].beforeValue = reservation.name;
    logData[86].afterValue = "";
    logData[87] = {};
    logData[87].fieldName = "氏名結合（姓名）（全角空白あり）";
    logData[87].beforeValue = reservation.nameView1;
    logData[87].afterValue = "";
    logData[88] = {};
    logData[88].fieldName = "氏名結合（姓名）";
    logData[88].beforeValue = reservation.nameView2;
    logData[88].afterValue = "";
    logData[89] = {};
    logData[89].fieldName = "名前カナ（姓）";
    logData[89].beforeValue = reservation.lastNameKana;
    logData[89].afterValue = "";
    logData[90] = {};
    logData[90].fieldName = "名前カナ（名）";
    logData[90].beforeValue = reservation.firstNameKana;
    logData[90].afterValue = "";
    logData[91] = {};
    logData[91].fieldName = "名前カナ（姓名）";
    logData[91].beforeValue = reservation.nameKana;
    logData[91].afterValue = "";
    logData[92] = {};
    logData[92].fieldName = "表示用カナ名前結合（全角空白あり）";
    logData[92].beforeValue = reservation.nameKanaView1;
    logData[92].afterValue = "";
    logData[93] = {};
    logData[93].fieldName = "表示用カナ名前結合（そのまま）";
    logData[93].beforeValue = reservation.nameKanaView2;
    logData[93].afterValue = "";
    logData[94] = {};
    logData[94].fieldName = "性別";
    logData[94].beforeValue = reservation.gender;
    logData[94].afterValue = "";
    logData[95] = {};
    logData[95].fieldName = "生年月日（8桁）";
    logData[95].beforeValue = reservation.birthday;
    logData[95].afterValue = "";
    logData[96] = {};
    logData[96].fieldName = "生年月日";
    logData[96].beforeValue = reservation.birthdayDatetime;
    logData[96].afterValue = "";
    logData[97] = {};
    logData[97].fieldName = "生年月日（元号）";
    logData[97].beforeValue = reservation.birthdayEraName;
    logData[97].afterValue = "";
    logData[98] = {};
    logData[98].fieldName = "生年月日（和暦）";
    logData[98].beforeValue = reservation.birthdayEraYear;
    logData[98].afterValue = "";
    logData[99] = {};
    logData[99].fieldName = "メールアドレス";
    logData[99].beforeValue = reservation.emailAddress;
    logData[99].afterValue = "";
    logData[100] = {};
    logData[100].fieldName = "電話番号（分割）";
    logData[100].beforeValue = reservation.telNo;
    logData[100].afterValue = "";
    logData[101] = {};
    logData[101].fieldName = "電話番号（ハイフンあり）";
    logData[101].beforeValue = reservation.telNoHyphen;
    logData[101].afterValue = "";
    logData[102] = {};
    logData[102].fieldName = "携帯電話番号（分割）";
    logData[102].beforeValue = reservation.mobileTelNo;
    logData[102].afterValue = "";
    logData[103] = {};
    logData[103].fieldName = "携帯電話番号（ハイフンあり）";
    logData[103].beforeValue = reservation.mobileTelNoHyphen;
    logData[103].afterValue = "";
    logData[104] = {};
    logData[104].fieldName = "FAX番号（分割）";
    logData[104].beforeValue = reservation.faxNo;
    logData[104].afterValue = "";
    logData[105] = {};
    logData[105].fieldName = "FAX番号（ハイフンあり）";
    logData[105].beforeValue = reservation.faxNoHyphen;
    logData[105].afterValue = "";
    logData[106] = {};
    logData[106].fieldName = "緊急連絡先電話番号（分割）";
    logData[106].beforeValue = reservation.emergencyTelNo;
    logData[106].afterValue = "";
    logData[107] = {};
    logData[107].fieldName = "緊急連絡先電話番号（ハイフンあり）";
    logData[107].beforeValue = reservation.emergencyTelNoHyphen;
    logData[107].afterValue = "";
    logData[108] = {};
    logData[108].fieldName = "予備電話番号（分割）";
    logData[108].beforeValue = reservation.spareTelNo;
    logData[108].afterValue = "";
    logData[109] = {};
    logData[109].fieldName = "予備電話番号（ハイフンあり）";
    logData[109].beforeValue = reservation.spareTelNoHyphen;
    logData[109].afterValue = "";
    logData[110] = {};
    logData[110].fieldName = "郵便番号（分割）";
    logData[110].beforeValue = reservation.zipCode;
    logData[110].afterValue = "";
    logData[111] = {};
    logData[111].fieldName = "郵便番号（8桁ハイフンあり）";
    logData[111].beforeValue = reservation.zipCodeHyphen;
    logData[111].afterValue = "";
    logData[112] = {};
    logData[112].fieldName = "都道府県（リスト）";
    logData[112].beforeValue = reservation.prefectureNameList;
    logData[112].afterValue = "";
    logData[113] = {};
    logData[113].fieldName = "都道府県";
    logData[113].beforeValue = reservation.prefectureName;
    logData[113].afterValue = "";
    logData[114] = {};
    logData[114].fieldName = "市区町村";
    logData[114].beforeValue = reservation.cityName;
    logData[114].afterValue = "";
    logData[115] = {};
    logData[115].fieldName = "町名";
    logData[115].beforeValue = reservation.townName;
    logData[115].afterValue = "";
    logData[116] = {};
    logData[116].fieldName = "番地";
    logData[116].beforeValue = reservation.addressName;
    logData[116].afterValue = "";
    logData[117] = {};
    logData[117].fieldName = "ビル名";
    logData[117].beforeValue = reservation.building;
    logData[117].afterValue = "";
    logData[118] = {};
    logData[118].fieldName = "住所結合（都道府県市区町村町名番地ビル名）";
    logData[118].beforeValue = reservation.address1;
    logData[118].afterValue = "";
    logData[119] = {};
    logData[119].fieldName = "住所結合（市区町村町名番地ビル名）";
    logData[119].beforeValue = reservation.address2;
    logData[119].afterValue = "";
    logData[120] = {};
    logData[120].fieldName = "住所結合（市区町村町名番地）";
    logData[120].beforeValue = reservation.address3;
    logData[120].afterValue = "";
    logData[121] = {};
    logData[121].fieldName = "都道府県カナ（リスト）";
    logData[121].beforeValue = reservation.prefectureNameKanaList;
    logData[121].afterValue = "";
    logData[122] = {};
    logData[122].fieldName = "都道府県カナ";
    logData[122].beforeValue = reservation.prefectureNameKana;
    logData[122].afterValue = "";
    logData[123] = {};
    logData[123].fieldName = "市区町村カナ";
    logData[123].beforeValue = reservation.cityNameKana;
    logData[123].afterValue = "";
    logData[124] = {};
    logData[124].fieldName = "町名カナ";
    logData[124].beforeValue = reservation.townNameKana;
    logData[124].afterValue = "";
    logData[125] = {};
    logData[125].fieldName = "番地カナ";
    logData[125].beforeValue = reservation.addressNameKana;
    logData[125].afterValue = "";
    logData[126] = {};
    logData[126].fieldName = "ビル名カナ";
    logData[126].beforeValue = reservation.buildingKana;
    logData[126].afterValue = "";
    logData[127] = {};
    logData[127].fieldName = "住所カナ結合（都道府県市区町村町名番地ビル名）";
    logData[127].beforeValue = reservation.addressKana1;
    logData[127].afterValue = "";
    logData[128] = {};
    logData[128].fieldName = "住所カナ結合（市区町村町名番地ビル名）";
    logData[128].beforeValue = reservation.addressKana2;
    logData[128].afterValue = "";
    logData[129] = {};
    logData[129].fieldName = "住所カナ結合（市区町村町名番地）";
    logData[129].beforeValue = reservation.addressKana3;
    logData[129].afterValue = "";
    logData[130] = {};
    logData[130].fieldName = "被保険者記号";
    logData[130].beforeValue = reservation.insuredPersonSymbol;
    logData[130].afterValue = "";
    logData[131] = {};
    logData[131].fieldName = "被保険者番号";
    logData[131].beforeValue = reservation.insuredPersonNo;
    logData[131].afterValue = "";
    logData[132] = {};
    logData[132].fieldName = "被保険者結合情報";
    logData[132].beforeValue = reservation.insuredPerson;
    logData[132].afterValue = "";
    logData[133] = {};
    logData[133].fieldName = "被保険者氏名";
    logData[133].beforeValue = reservation.insuredPersonName;
    logData[133].afterValue = "";
    logData[134] = {};
    logData[134].fieldName = "保険者番号";
    logData[134].beforeValue = reservation.insurerNo;
    logData[134].afterValue = "";
    logData[135] = {};
    logData[135].fieldName = "保険加入者区分";
    logData[135].beforeValue = reservation.insuranceSubscribeClass;
    logData[135].afterValue = "";
    logData[136] = {};
    logData[136].fieldName = "顧客メモ";
    logData[136].beforeValue = reservation.memo;
    logData[136].afterValue = "";
    return logData;
}