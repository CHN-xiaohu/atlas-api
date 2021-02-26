import {proImagesOperator} from "../../lib/qiniuyun";

(async () => {
    const {data} = await proImagesOperator.createImageSearchLibrary([]);
    console.log("处理完毕", data);
})();
