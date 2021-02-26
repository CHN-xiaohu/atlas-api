import {devImagesOperator} from "../../lib/qiniuyun";

(async () => {
    const {data} = await devImagesOperator.showAllImagesOnLibrary();

    console.dir(data, {depth: 10});
})();
