import {mongo} from "../lib/db";

const originalData = [
    {
      _id: "5e7c4d90143e3e40d6eb8bc6",
      photos: [
        'https://files.globus.furniture/344678d05c6549284a28d82dfc45487f.jpg'
      ]
    },
    {
      _id: "5e7c504d143e3e40d6eb8bc9",
      photos: [
        'https://files.globus.furniture/430e4056d6f07cdcc5309f5d401f8525.jpg'
      ]
    },
    {
      _id: "5e7c521e143e3e40d6eb8bd3",
      photos: [
        'https://files.globus.furniture/1e710d4e1c468c9ad772755e7710ca01.jpg'
      ]
    },
    {
      _id: "5e7c548a143e3e40d6eb8bd5",
      photos: [
        'https://files.globus.furniture/8fde580a4bf51f7bad00d7bd41bd72b0.jpg'
      ]
    },
    {
      _id: "5e7c5837ef09e84715954e60",
      photos: [
        'https://files.globus.furniture/c10c533f77b0ced405e827f4fd46cbe5.jpg'
      ]
    },
    {
      _id: "5e7c5a7fef09e84715954e62",
      photos: [
        'https://files.globus.furniture/c10c533f77b0ced405e827f4fd46cbe5.jpg'
      ]
    },
    {
      _id: "5e7c5b47ef09e84715954e64",
      photos: [
        'https://files.globus.furniture/a81ebc4da8b2c1b19a729c98e1f464e1.jpg'
      ]
    },
    {
      _id: "5e7c5faeef09e84715954e66",
      photos: [
        'https://files.globus.furniture/c3e048fcd9a80c811d552991b8b1d5de.jpg'
      ]
    },
    {
      _id: "5e7c6d984edf0252e778e4df",
      photos: [
        'https://files.globus.furniture/314283285a43147acef27277679df2e8.jpg'
      ]
    },
    {
      _id: "5e7c6eba4edf0252e778e4e3",
      photos: [
        'https://files.globus.furniture/c35ccdb23f9295bbf29efe6c0b1c06c5.jpg'
      ]
    }
]

const db = mongo.get("products");

(async () => {
    originalData.forEach(item => {
        db.update({_id: item._id}, {$set: {photos: item.photos}});
    });
})();
