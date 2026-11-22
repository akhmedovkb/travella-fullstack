const directory=require('../data/aviation/directory.json');
function lookup(map,value){const code=String(value??'').trim().toUpperCase();return Object.hasOwn(map,code)?map[code]:undefined;}
function displayCity(value){return lookup(directory.cities,value)||lookup(directory.citiesIcao,value)||value;}
function displayAirport(value){return lookup(directory.airports,value)||lookup(directory.airportsIcao,value)||value;}
function displayAirline(value){return lookup(directory.airlines,value)||lookup(directory.airlinesIcao,value)||value;}
function isPlaceCode(value){return /^[A-Z]{3}$/.test(value)||!!lookup(directory.citiesIcao,value);}
function displayBookingTitle(value){return /^Отказной (?:тур|авиабилет) — /i.test(value||'')?String(value).replace(/\b[A-Z]{3}\b/g,displayCity):value;}
module.exports={displayCity,displayAirport,displayAirline,isPlaceCode,displayBookingTitle,source:directory.source};
