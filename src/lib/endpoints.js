import {images} from "../endpoints/images";
import {tasks} from "../endpoints/tasks";
import {invoices} from "../endpoints/invoices";
import {leads} from "../endpoints/leads";
import {contacts} from "../endpoints/contacts";
import {periods} from "../endpoints/periods";
import {pipelines} from "../endpoints/pipelines";
import {users} from "../endpoints/users";
import {templates} from "../endpoints/templates";
import {notifications} from "../endpoints/notifications";
import {links} from "../endpoints/links";
import {purchases} from "../endpoints/purchases";
import {managers} from "../endpoints/managers";
import {comments} from "../endpoints/comments";
import {files} from "../endpoints/files";
import {chats} from "../endpoints/chats";
import {suppliers} from "../endpoints/suppliers";
import {products} from "../endpoints/products";
import {productOptions} from "../endpoints/productOptions";
import {waMessages} from "../endpoints/waMessages";
import {waChats} from "../endpoints/waChats";
import {logs} from "../endpoints/logs";
import {dictionaries} from "../endpoints/dictionaries";
import {receipts} from "../endpoints/receipts";
import {newQuotations} from "../endpoints/newQuotations";
import {newQuotationItems} from "../endpoints/newQuotationItems";
import {notes} from "../endpoints/notes";
import {emails} from "../endpoints/emails";
import {social} from "../endpoints/social";

const getEndpoint = (() => {
    const endpoints = {
        images,
        tasks,
        notes,
        emails,
        invoices,
        leads,
        contacts,
        periods,
        pipelines,
        users,
        templates,
        notifications,
        links,
        purchases,
        managers,
        comments,
        files,
        chats,
        suppliers,
        products,
        productOptions,
        waMessages,
        waChats,
        logs,
        dictionaries,
        receipts,
        newQuotations,
        newQuotationItems,
        social
    };

    return endpoint => (endpoint == null ? endpoints : endpoints[endpoint]);
})();

export const endpoints = new Proxy(
    {},
    {
        get: (target, prop) => {
            return getEndpoint(prop);
        },
    },
);
