import {proImagesOperator} from "../../lib/qiniuyun";

(async () => {
    const {data} = await proImagesOperator.showAllImagesOnLibrary();

    console.dir(data, {depth: 10});
})();
