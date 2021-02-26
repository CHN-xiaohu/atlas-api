export const print = (...params) => {
    console.log("[console script] ", ...params);
}

export const printArea = async (params, callback) => {
    const finalParams = [].concat(params);
    print(...finalParams, "开始");
    const result = await callback();
    print(...finalParams, "结束");
    return result;
}

const defaultFunc = () => {}
export const retry = async ({
    maxTimes = 3,
    callback = defaultFunc,
    onError = defaultFunc,
    onMaxTimesError = defaultFunc,
    initTimes = 1
}) => {
    if (initTimes > maxTimes) return await onMaxTimesError(initTimes);

    try {
        return await callback(initTimes);
    } catch (error) {
        await onError(error, initTimes);
        await retry({callback, onError, maxTimes, initTimes: initTimes +1});
    }
}
