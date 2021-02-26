import {proImagesOperator} from "../../lib/qiniuyun";

//const groupId = "products";

(async () => {
    proImagesOperator.removeImageSearchLibrary();
    console.log("处理完毕");
})();
