import type { Lang } from './lang'

/**
 * Misspellings people who spell by sound make often, with the word they mean. The dictionary's own
 * suggestions go by letters, so for these it often has the right word far down or not at all.
 * Also: game words both languages borrow, which no dictionary lists.
 */

const table = (s: string) => new Map(s.trim().split(/\s*\n\s*|\s*;\s*/).map((e) => e.split(':') as [string, string]))

export const KNOWN_WRONG: Record<Lang, Map<string, string>> = {
  en: table(`
    wich:which; whith:with; wiht:with; teh:the; alot:a lot; aswell:as well; infact:in fact; eachother:each other; noone:no one; incase:in case; atleast:at least; ofcourse:of course; abit:a bit
    untill:until; wether:whether; becuase:because; becuse:because; becouse:because; beacuse:because; bekause:because; definately:definitely; definatly:definitely; seperate:separate
    recieve:receive; beleive:believe; freind:friend; freinds:friends; wierd:weird; thier:their; tommorow:tomorrow; tomorow:tomorrow; occured:occurred; begining:beginning; comming:coming
    writting:writing; grammer:grammar; truely:truly; realy:really; basicly:basically; probly:probably; probaly:probably; propably:probably; diffrent:different; intresting:interesting
    nessesary:necessary; neccessary:necessary; necesary:necessary; enviroment:environment; existance:existence; succesful:successful; sucess:success; acheive:achieve; accross:across
    adress:address; agressive:aggressive; apparantly:apparently; arguement:argument; buisness:business; bussiness:business; calender:calendar; charachter:character; charakter:character
    caracter:character; charcter:character; concious:conscious; dissapear:disappear; dissapoint:disappoint; embarass:embarrass; excercise:exercise; familar:familiar; finaly:finally
    foward:forward; garantee:guarantee; gaurantee:guarantee; happend:happened; immediatly:immediately; knowlege:knowledge; lenght:length; strenght:strength; hight:height; libary:library
    lisence:license; noticable:noticeable; occurence:occurrence; persue:pursue; posession:possession; prefered:preferred; reccomend:recommend; recomend:recommend; refered:referred
    relevent:relevant; remeber:remember; rember:remember; resistence:resistance; rythm:rhythm; rhytm:rhythm; shedule:schedule; similiar:similar; speach:speech; suprise:surprise
    therefor:therefore; threshhold:threshold; tounge:tongue; unfortunatly:unfortunately; usefull:useful; woudl:would; shoudl:should; coudl:could; allready:already; allways:always
    allmost:almost; fone:phone; enuff:enough; shure:sure; nite:night; tryed:tried; payed:paid; layed:laid; sayed:said; goed:went; thinked:thought; catched:caught; buyed:bought
    bringed:brought; teached:taught; maked:made; taked:took; gived:gave; writed:wrote; runned:ran; drawed:drew; hurted:hurt; choosed:chose; feeled:felt; keeped:kept; leaved:left
    meaned:meant; sended:sent; spended:spent; builded:built; losed:lost; winned:won; selled:sold; telled:told; finded:found; knowed:knew; growed:grew; throwed:threw; falled:fell
    holded:held; heared:heard; childs:children; womans:women; mouses:mice; foots:feet; tooths:teeth; enemys:enemies; abilitys:abilities; storys:stories; partys:parties; citys:cities
    armys:armies; desing:design; langauge:language; grafik:graphic; grafic:graphic; dosent:doesn't; doesnt:doesn't; dont:don't; didnt:didn't; isnt:isn't; arent:aren't; wasnt:wasn't
    werent:weren't; hasnt:hasn't; havent:haven't; hadnt:hadn't; couldnt:couldn't; wouldnt:wouldn't; shouldnt:shouldn't; im:I'm; ive:I've; youre:you're; theyre:they're; thats:that's
    whats:what's; theres:there's; hes:he's; shes:she's; weve:we've; youve:you've; theyve:they've; youll:you'll; theyll:they'll; itll:it'll; und:and; oder:or; ist:is; nicht:not
    gard:guard; kann:can; wird:word; wen:when; villige:village; sheild:shield; expirience:experience; experiance:experience; independant:independent; goverment:government; maintainance:maintenance; tendancy:tendency; publically:publicly; mispell:misspell
  `),
  de: table(`
    villeicht:vielleicht; vieleicht:vielleicht; fileicht:vielleicht; vielleich:vielleicht; warscheinlich:wahrscheinlich; wahrscheinlig:wahrscheinlich; eigendlich:eigentlich
    nähmlich:nämlich; nemlich:nämlich; standart:Standard; wiederstand:Widerstand; wiederspruch:Widerspruch; wiederspiegeln:widerspiegeln; wiederlich:widerlich; wiedersprechen:widersprechen
    erwiedern:erwidern; widerholen:wiederholen; intressant:interessant; interressant:interessant; interresse:Interesse; rythmus:Rhythmus; maschiene:Maschine; nich:nicht; nciht:nicht
    udn:und; shcon:schon; schohn:schon; auserdem:außerdem; ausserdem:außerdem; addresse:Adresse; agressiv:aggressiv; vorraus:voraus; vorraussetzung:Voraussetzung; garnicht:gar nicht
    garnichts:gar nichts; garkein:gar kein; vorallem:vor allem; aufjedenfall:auf jeden Fall; ausversehen:aus Versehen; immernoch:immer noch; zumindestens:zumindest; einzigste:einzige
    ebend:eben; anstadt:anstatt; stadtdessen:stattdessen; morgends:morgens; nichtmal:nicht mal; irgentwie:irgendwie; irgentwas:irgendwas; irgentwann:irgendwann; entgültig:endgültig
    entlich:endlich; tötlich:tödlich; todlich:tödlich; seperat:separat; orginal:original; orginell:originell; projeckt:Projekt; packet:Paket; gallerie:Galerie; terasse:Terrasse
    atacke:Attacke; karakter:Charakter; charackter:Charakter; lizens:Lizenz; resource:Ressource; resourcen:Ressourcen; detailiert:detailliert; assozial:asozial; anderst:anders
    ebenfals:ebenfalls; jedenfals:jedenfalls; fals:falls; trozdem:trotzdem; totzdem:trotzdem; obwol:obwohl; wärend:während; wehrend:während; ungefär:ungefähr; ungefair:ungefähr
    ziehmlich:ziemlich; zimlich:ziemlich; hofentlich:hoffentlich; plözlich:plötzlich; wahrum:warum; wier:wir; dier:dir; mier:mir; wolte:wollte; solte:sollte; konte:konnte
    muste:musste; hate:hatte; währe:wäre; giebt:gibt; gieb:gib; fertich:fertig; richtich:richtig; wichtich:wichtig; lustich:lustig; aufeinmal:auf einmal; zuviel:zu viel
    wieviel:wie viel; desshalb:deshalb; algemein:allgemein; almählich:allmählich; apropo:apropos; bischen:bisschen; bißchen:bisschen; daß:dass; muß:muss; ersteinmal:erst einmal
    hälst:hältst; haubtsache:Hauptsache; kaput:kaputt; kentnisse:Kenntnisse; lezte:letzte; lezten:letzten; nacher:nachher; nartürlich:natürlich; natührlich:natürlich; ofiziell:offiziell
    paralell:parallel; passirt:passiert; pasiert:passiert; reperatur:Reparatur; reperieren:reparieren; sympatisch:sympathisch; sebst:selbst; spatzieren:spazieren; tollerant:tolerant
    übrigends:übrigens; wiso:wieso; wolen:wollen; zurük:zurück; zusamen:zusammen; fater:Vater; grafick:Grafik; desweiteren:des Weiteren; zuende:zu Ende; vileicht:vielleicht
  `),
}

/** Game design words used in English and German text alike. */
export const GAME_WORDS = new Set(
  'gameplay cooldown cooldowns hitbox hitboxes hurtbox loot lootbox spawn spawns spawner respawn respawns despawn buff buffs debuff debuffs nerf nerfs boss bosse bossfight quest quests sidequest mainquest npc npcs dps hp mp xp exp crafting craften skilltree skillpunkt skillpunkte level leveln levelup levelaufstieg leveldesign gamedesign game games gamer feature features bug bugs patch patches update updates savegame savepoint checkpoint checkpoints roguelike roguelite metroidvania soulslike sandbox openworld multiplayer singleplayer coop pvp pve mob mobs aggro tank healer dungeon dungeons raid raids endgame lategame midgame earlygame speedrun tutorial tutorials hud ui ux sprite sprites tileset tilesets tilemap shader shaders asset assets playtest playtests playtester balancing mana stamina combo combos crit crits knockback stun dash dodge parry inventory item items equipment gear perk perks drop drops droprate grind grinden farmen cutscene cutscenes minimap overworld worldbuilding lore storyboard moodboard pixelart highscore leaderboard gamepad controller joystick framerate fps lag ingame px png jpg gif json csv pdf svg html css url api gui app apps github discord youtube wiki blog emoji online offline ok okay'.split(' '),
)
