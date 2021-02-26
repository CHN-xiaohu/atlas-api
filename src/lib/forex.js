import dayjs from "dayjs";
import axios from "axios";
import {cacheStorage} from "./cache";
import {set} from "./socket-storage"

const {get} = axios.create({
    responseType: "json",
});

const cache = cacheStorage("forex");

export const forex = async () => {
    const cacheKey = `forex-${dayjs().format("YYYY-MM-DD")}`;
    if (cache[cacheKey] == null) {
        cache[cacheKey] = get("https://www.cbr-xml-daily.ru/daily_json.js");
    }
    const {Date: date, Valute: rates} = (await cache[cacheKey]).data;
    const CNY = rates.CNY.Value / rates.CNY.Nominal;
    const prevCNY = rates.CNY.Previous / rates.CNY.Nominal;
    const USD = rates.USD.Value / rates.USD.Nominal;
    const prevUSD = rates.USD.Previous / rates.USD.Nominal;
    return {
        USD: {
            value: CNY / USD,
            previous: prevCNY / prevUSD,
            date,
        },
        RUB: {
            value: CNY,
            previous: prevCNY,
            date,
        },
    };
};

forex().then(data => set('forex', data))
