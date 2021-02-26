import {imagesOperator} from "../../lib/qiniuyun";

(async () => {
    const {data} = await imagesOperator.getImageInfoOnLibrary("5fdaecbb22e9d46488e94e43|5fdaebf522e9d46488e94e40");
    console.log("data", data);
})();
