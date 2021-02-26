import {proImagesOperator} from "../../lib/qiniuyun";

(async () => {
    const url = "https://images.globus.furniture/original-images/384f7b06-ade8-4c78-a4af-39a923400f97|original";

    const {data} = await proImagesOperator.searchImage(url, 5);
    console.log(data);
})();
