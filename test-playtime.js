const lines = [
  "[: HunterCookies799 fell from a high place",
  "[14:35:01] [Server thread/INFO]: HunterCookies799 fell from a high place",
  "[14:35:01] [Server thread/INFO]: HunterCookies799 died",
  "[14:35:01] [Server thread/INFO]: HunterCookies799 was slain by Zombie",
  "[14:35:01] [Server thread/INFO]: HunterCookies799 has made the advancement [Stone Age]"
];

for (const message of lines) {
  const deathMatch = message.match(/\]: (?<name>[A-Za-z0-9_]{1,16}) (?<reason>(fell|was|blew|burned|tried|hit|died|withered|drowned|starved|suffocated|froze|went off|experienced|walked into|discovered|impaled|squashed|shot).*)$/);
  console.log(message, '->', deathMatch?.groups);
}
