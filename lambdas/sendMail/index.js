const AWS = require("aws-sdk");
const ses = new AWS.SES({ region: "ap-northeast-1" });

exports.handler = async (event) => {
    console.log(event);
    try {
        if (event != null) {
            const result = await ses.sendEmail(event).promise();
            if (result.$response.error) throw (500, result.$response.error.message);
            return result;
        }
        else {
            throw (500, "Invalid parameter");
        }
    } catch (error) {
        console.log("error", error);
        return error;
    }
};
