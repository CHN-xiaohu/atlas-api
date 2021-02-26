import {devImagesOperator} from "../../lib/qiniuyun";

(async () => {
    await devImagesOperator.removeImageSearchLibrary();
    console.log("删除完毕");
    await devImagesOperator.createImageSearchLibrary();
    console.log("添加完毕");
})();
