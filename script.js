console.log("JS is connected!");


/* ---------- 1. SETTINGS ---------- */

const TOURNAMENTS_KEY = 'tourneyshq_tournaments';
const PLAN_KEY = 'tourneyshq_plan';

// Prices are in naira (₦). Keep them the same as the data- numbers in index.html.
const PLANS = {
    free: {
        name: 'Free', maxTeams: 8, monthly: 0, annual: 0,
        formats: ['round-robin', 'knockout'],
        print: false, share: false, reminders: false, tiebreaks: false
    },
    club: {
        name: 'Club', maxTeams: 32, monthly: 7000, annual: 5600,
        formats: ['round-robin', 'knockout', 'groups'],
        print: true, share: true, reminders: true, tiebreaks: false
    },
    league: {
        name: 'League', maxTeams: Infinity, monthly: 20000, annual: 16000,
        formats: ['round-robin', 'knockout', 'groups'],
        print: true, share: true, reminders: true, tiebreaks: true
    }
};


const FORMAT_LABELS = {
    'round-robin': 'Round-robin',
    'knockout': 'Knockout',
    'groups': 'Groups + knockout'
};

const SPORT_LABELS = {
    football: 'Football',
    basketball: 'Basketball',
    volleyball: 'Volleyball',
    esports: 'Esports',
    other: 'Other'
};

const MIN_TEAMS = { 'round-robin': 3, 'knockout': 2, 'groups': 4 };

const THEME_KEY = 'tourneyshq_theme';


/* ---------- 2. SMALL HELPERS ---------- */

// Short names for finding things on the page
function $(selector, root = document) {
    return root.querySelector(selector);
}

function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

// Makes a new HTML element: el('p', 'card-meta', 'Hello')
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// 7000 -> "7,000"
function formatNumber(number) {
    return Number(number).toLocaleString('en-US');
}


/* ---------- 3. SAVING AND LOADING (localStorage) ---------- */

function loadTournaments() {
    try {
        const saved = JSON.parse(localStorage.getItem(TOURNAMENTS_KEY));
        return Array.isArray(saved) ? saved : [];
    } catch (error) {
        return [];
    }
}

function saveTournaments(list) {
    try {
        localStorage.setItem(TOURNAMENTS_KEY, JSON.stringify(list));
        return true;
    } catch (error) {
        alert('Sorry, this browser would not let us save your tournament.');
        return false;
    }
}

function getTournament(id) {
    return loadTournaments().find(function (t) { return t.id === id; }) || null;
}

// Saves one tournament: replaces it if it exists, adds it if it is new
function saveTournament(tournament) {
    const list = loadTournaments();
    const position = list.findIndex(function (t) { return t.id === tournament.id; });
    if (position === -1) {
        list.push(tournament);
    } else {
        list[position] = tournament;
    }
    return saveTournaments(list);
}

function deleteTournament(id) {
    saveTournaments(loadTournaments().filter(function (t) { return t.id !== id; }));
}

function getCurrentPlan() {
    try {
        const saved = JSON.parse(localStorage.getItem(PLAN_KEY));
        if (saved && PLANS[saved.plan]) return saved.plan;
    } catch (error) {
        // ignore and fall through to the Free plan
    }
    return 'free';
}

function setCurrentPlan(plan, billing) {
    try {
        localStorage.setItem(PLAN_KEY, JSON.stringify({ plan: plan, billing: billing }));
    } catch (error) {
        // nothing we can do, the plan just won't be remembered
    }
}


/* ---------- 4. TOURNAMENT LOGIC (no page code in this part) ---------- */

// Mixes a list randomly, like shuffling cards
function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = copy[i];
        copy[i] = copy[j];
        copy[j] = temp;
    }
    return copy;
}

function hasResult(match) {
    return match.homeScore !== null && match.awayScore !== null;
}

// Who won this match? Returns a team name, or null if nobody has yet
function getWinner(match) {
    if (match.bye) return match.home || match.away;
    if (!match.home || !match.away) return null;
    if (!hasResult(match)) return null;
    if (match.homeScore === match.awayScore) return null;
    return match.homeScore > match.awayScore ? match.home : match.away;
}

// Round-robin: the "circle method". Returns a list of rounds,
// and each round is a list of [home, away] pairs.
function roundRobinPairings(teams) {
    const list = teams.slice();
    if (list.length % 2 === 1) list.push(null); // null = a rest week
    const size = list.length;
    const rounds = [];

    for (let r = 0; r < size - 1; r++) {
        const pairs = [];
        for (let i = 0; i < size / 2; i++) {
            const a = list[i];
            const b = list[size - 1 - i];
            if (a !== null && b !== null) {
                pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
            }
        }
        rounds.push(pairs);
        list.splice(1, 0, list.pop()); // rotate everyone except the first team
    }
    return rounds;
}

function makeLeagueMatches(teams, stage, groupName) {
    const matches = [];
    roundRobinPairings(teams).forEach(function (pairs, r) {
        pairs.forEach(function (pair) {
            matches.push({
                stage: stage,
                group: groupName,
                round: r + 1,
                roundName: 'Round ' + (r + 1),
                index: matches.length,
                home: pair[0],
                away: pair[1],
                homeScore: null,
                awayScore: null,
                bye: false,
                time: ''
            });
        });
    });
    return matches;
}

// Knockout: pairs teams up and gives byes (free passes) when the
// number of teams is not 2, 4, 8, 16...
function makeFirstRoundPairs(teams) {
    let size = 1;
    while (size < teams.length) size *= 2;

    const slots = teams.slice();
    while (slots.length < size) slots.push(null); // null = a bye

    const pairs = [];
    for (let i = 0; i < size / 2; i++) {
        pairs.push([slots[i], slots[size - 1 - i]]);
    }
    return pairs;
}

function knockoutRoundName(round, totalRounds) {
    const remaining = totalRounds - round;
    if (remaining === 0) return 'Final';
    if (remaining === 1) return 'Semi-finals';
    if (remaining === 2) return 'Quarter-finals';
    return 'Round of ' + Math.pow(2, remaining + 1);
}

// Builds every knockout round up front. Later rounds start empty (TBD).
function makeKnockoutMatches(pairs) {
    const totalRounds = Math.log2(pairs.length) + 1;
    const matches = [];
    let count = pairs.length;

    for (let round = 1; round <= totalRounds; round++) {
        for (let i = 0; i < count; i++) {
            const pair = round === 1 ? pairs[i] : [null, null];
            matches.push({
                stage: 'knockout',
                group: '',
                round: round,
                roundName: knockoutRoundName(round, totalRounds),
                index: i,
                home: pair[0],
                away: pair[1],
                homeScore: null,
                awayScore: null,
                bye: round === 1 && ((pair[0] === null) !== (pair[1] === null)),
                time: ''
            });
        }
        count = count / 2;
    }
    return matches;
}

// Moves winners into the next round. If a team in a later match
// changes, that match's old score is cleared.
function refreshBracket(tournament) {
    const knockout = tournament.matches.filter(function (m) { return m.stage === 'knockout'; });
    if (knockout.length === 0) return;

    const lastRound = Math.max.apply(null, knockout.map(function (m) { return m.round; }));

    for (let r = 2; r <= lastRound; r++) {
        const previous = knockout
            .filter(function (m) { return m.round === r - 1; })
            .sort(function (a, b) { return a.index - b.index; });

        knockout
            .filter(function (m) { return m.round === r; })
            .forEach(function (m) {
                const newHome = getWinner(previous[m.index * 2]);
                const newAway = getWinner(previous[m.index * 2 + 1]);
                if (m.home !== newHome || m.away !== newAway) {
                    m.homeScore = null;
                    m.awayScore = null;
                }
                m.home = newHome;
                m.away = newAway;
            });
    }
}

// The league table. Sorted by points, then goal difference, then goals scored.
// Orders two teams: points first, then the chosen tie-break rule
function compareRows(x, y, tiebreak) {
    const points = y.pts - x.pts;
    if (points) return points;

    let order;
    if (tiebreak === 'gf') {
        order = (y.gf - x.gf) || (y.gd - x.gd);
    } else if (tiebreak === 'wins') {
        order = (y.w - x.w) || (y.gd - x.gd);
    } else {
        order = (y.gd - x.gd) || (y.gf - x.gf);
    }
    return order || x.team.localeCompare(y.team);
}

function computeStandings(teams, matches, tiebreak) {
    const table = new Map();
    teams.forEach(function (team) {
        table.set(team, { team: team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
    });

    matches.forEach(function (m) {
        if (!hasResult(m)) return;
        const home = table.get(m.home);
        const away = table.get(m.away);
        if (!home || !away) return;

        home.p++; away.p++;
        home.gf += m.homeScore; home.ga += m.awayScore;
        away.gf += m.awayScore; away.ga += m.homeScore;

        if (m.homeScore > m.awayScore) {
            home.w++; away.l++; home.pts += 3;
        } else if (m.homeScore < m.awayScore) {
            away.w++; home.l++; away.pts += 3;
        } else {
            home.d++; away.d++; home.pts += 1; away.pts += 1;
        }
    });

    const rows = Array.from(table.values());
    rows.forEach(function (row) { row.gd = row.gf - row.ga; });
    rows.sort(function (x, y) {
        return compareRows(x, y, tiebreak);
    });
    return rows;
}

// Groups + knockout: splits the teams into 2 or 4 groups
function makeGroups(teams) {
    const groupCount = teams.length >= 12 ? 4 : 2;
    const groups = [];
    for (let i = 0; i < groupCount; i++) {
        groups.push({ name: 'Group ' + String.fromCharCode(65 + i), teams: [] });
    }
    shuffle(teams).forEach(function (team, i) {
        groups[i % groupCount].teams.push(team);
    });
    return groups;
}

// Group winners play runners-up from another group
function makeGroupPairs(qualifiers) {
    if (qualifiers.length === 2) {
        return [
            [qualifiers[0][0], qualifiers[1][1]],
            [qualifiers[1][0], qualifiers[0][1]]
        ];
    }
    return [
        [qualifiers[0][0], qualifiers[1][1]],
        [qualifiers[2][0], qualifiers[3][1]],
        [qualifiers[1][0], qualifiers[0][1]],
        [qualifiers[3][0], qualifiers[2][1]]
    ];
}

// Builds the knockout stage once every group match has a result,
// and rebuilds it if a group result changes who qualifies.
function syncGroupKnockout(tournament) {
    const groupMatches = tournament.matches.filter(function (m) { return m.stage === 'group'; });
    const finished = groupMatches.every(hasResult);
    const hasKnockout = tournament.matches.some(function (m) { return m.stage === 'knockout'; });

    if (!finished) {
        tournament.matches = groupMatches;
        tournament.qualifierKey = '';
        return;
    }

    const qualifiers = tournament.groups.map(function (group) {
        const rows = computeStandings(
            group.teams,
            groupMatches.filter(function (m) { return m.group === group.name; }),
            tournament.tiebreak
        );
        return [rows[0].team, rows[1].team];
    });

    const key = JSON.stringify(qualifiers);
    if (hasKnockout && key === tournament.qualifierKey) return;

    tournament.qualifierKey = key;
    tournament.matches = groupMatches.concat(makeKnockoutMatches(makeGroupPairs(qualifiers)));
}

// Call this after any score changes
function updateTournament(tournament) {
    if (tournament.format === 'groups') syncGroupKnockout(tournament);
    if (tournament.format !== 'round-robin') refreshBracket(tournament);
}

function getChampion(tournament) {
    if (tournament.format === 'round-robin') {
        if (!tournament.matches.every(hasResult)) return null;
        return computeStandings(tournament.teams, tournament.matches, tournament.tiebreak)[0].team;
    }
    const knockout = tournament.matches.filter(function (m) { return m.stage === 'knockout'; });
    if (knockout.length === 0) return null;
    return getWinner(knockout[knockout.length - 1]); // the last match is the final
}

// Creates a brand new tournament object, ready to save
function buildTournament(name, sport, format, teams, tiebreak) {
    const tournament = {
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name,
        sport: sport,
        format: format,
        teams: teams.slice(),
        createdAt: new Date().toISOString(),
        groups: [],
        matches: [],
        qualifierKey: '',
        tiebreak: tiebreak || 'gd',
        scorers: []
    };

    if (format === 'round-robin') {
        tournament.matches = makeLeagueMatches(shuffle(teams), 'league', '');
    } else if (format === 'knockout') {
        tournament.matches = makeKnockoutMatches(makeFirstRoundPairs(shuffle(teams)));
        refreshBracket(tournament);
    } else {
        tournament.groups = makeGroups(teams);
        tournament.groups.forEach(function (group) {
            tournament.matches = tournament.matches.concat(
                makeLeagueMatches(group.teams, 'group', group.name)
            );
        });
    }
    return tournament;
}


/* ---------- 5. HOME PAGE: the Monthly / Annual toggle ---------- */

function initPricingToggle() {
    const buttons = $$('.toggle-btn');
    if (buttons.length === 0) return;

    buttons.forEach(function (button) {
        button.addEventListener('click', function () {
            const billing = button.dataset.billing; // "monthly" or "annual"

            buttons.forEach(function (b) {
                b.classList.toggle('active', b === button);
            });

            // data-monthly / data-annual hold the plain numbers
            $$('.price').forEach(function (price) {
                price.textContent = formatNumber(price.dataset[billing]);
            });

            $$('.plan-price .period').forEach(function (period) {
                period.textContent = billing === 'annual' ? '/month, billed yearly' : '/month';
            });

            // Pass the billing choice on to the checkout page
            $$('a[href^="checkout.html"]').forEach(function (link) {
                const base = link.getAttribute('href').split('&')[0];
                link.setAttribute('href', base + '&billing=' + billing);
            });
        });
    });
}


/* ---------- 6. MY TOURNAMENTS PAGE ---------- */

function buildTournamentCard(tournament, onChange) {
    const card = el('article', 'tournament-card');
    card.appendChild(el('p', 'card-tag', FORMAT_LABELS[tournament.format] || tournament.format));
    card.appendChild(el('h3', '', tournament.name));
    card.appendChild(el(
        'p', 'card-meta',
        tournament.teams.length + ' teams · ' + (SPORT_LABELS[tournament.sport] || 'Other')
    ));

    const actions = el('div', 'card-actions');

    const openLink = el('a', 'btn btn-outline', 'Open');
    openLink.href = 'tournament.html?id=' + encodeURIComponent(tournament.id);
    actions.appendChild(openLink);

    const deleteButton = el('button', 'btn btn-outline btn-danger', 'Delete');
    deleteButton.type = 'button';
    deleteButton.addEventListener('click', function () {
        if (confirm('Delete "' + tournament.name + '"? This cannot be undone.')) {
            deleteTournament(tournament.id);
            onChange();
        }
    });
    actions.appendChild(deleteButton);

    card.appendChild(actions);
    return card;
}

function initTournamentsPage() {
    const grid = $('#tournament-list');
    const emptyState = $('#empty-state');
    if (!grid || !emptyState) return;

    function render() {
        const list = loadTournaments().slice().reverse(); // newest first
        grid.innerHTML = '';
        grid.hidden = list.length === 0;
        emptyState.hidden = list.length > 0;
        list.forEach(function (tournament) {
            grid.appendChild(buildTournamentCard(tournament, render));
        });
    }

    render();
}


/* ---------- 7. CREATE TOURNAMENT PAGE ---------- */

function initCreatePage() {
    const form = $('#create-form');
    if (!form) return;

    const plan = PLANS[getCurrentPlan()];
    const teams = [];
    const teamInput = $('#team-input');
    const teamList = $('#team-list');
    const hint = $('.form-hint');
    const errorBox = $('#form-error');

    teamInput.maxLength = 30;

    function showError(message, withPlansLink) {
        errorBox.textContent = message;
        if (withPlansLink) {
            errorBox.appendChild(document.createTextNode(' '));
            const link = el('a', '', 'See plans');
            link.href = 'index.html#pricing';
            errorBox.appendChild(link);
        }
    }

    function clearError() {
        errorBox.textContent = '';
    }

    function renderTeams() {
        teamList.innerHTML = '';

        teams.forEach(function (name, position) {
            const item = el('li');
            item.appendChild(el('span', '', name));

            const removeButton = el('button', 'team-remove', '×');
            removeButton.type = 'button';
            removeButton.setAttribute('aria-label', 'Remove ' + name);
            removeButton.addEventListener('click', function () {
                teams.splice(position, 1);
                clearError();
                renderTeams();
            });

            item.appendChild(removeButton);
            teamList.appendChild(item);
        });

        const limit = plan.maxTeams === Infinity ? 'unlimited teams' : 'up to ' + plan.maxTeams + ' teams';
        hint.textContent = teams.length + (teams.length === 1 ? ' team' : ' teams') +
            ' added. The ' + plan.name + ' plan allows ' + limit + '.';
    }

    // Returns true if the team was added, false if it was blocked
    function addTeam() {
        const name = teamInput.value.trim();
        if (name === '') return false;

        const alreadyThere = teams.some(function (team) {
            return team.toLowerCase() === name.toLowerCase();
        });
        if (alreadyThere) {
            showError('"' + name + '" is already in the list.');
            return false;
        }
        if (teams.length >= plan.maxTeams) {
            showError('The ' + plan.name + ' plan allows up to ' + plan.maxTeams + ' teams.', true);
            return false;
        }

        clearError();
        teams.push(name);
        teamInput.value = '';
        renderTeams();
        teamInput.focus();
        return true;
    }

    $('#add-team-btn').addEventListener('click', addTeam);

    // Pressing Enter adds the team instead of submitting the whole form
    teamInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            addTeam();
        }
    });

    form.addEventListener('submit', function (event) {
        event.preventDefault();

        // If a name is typed but "Add team" wasn't pressed, add it now.
        // If it gets blocked, stop here so the error message stays visible.
        if (teamInput.value.trim() !== '' && !addTeam()) return;

        const name = $('#tournament-name').value.trim();
        const sport = $('#sport').value;
        const format = $('input[name="format"]:checked').value;

        if (name === '') {
            showError('Please give your tournament a name.');
            return;
        }
        if (!plan.formats.includes(format)) {
            showError(FORMAT_LABELS[format] + ' is available on the Club and League plans.', true);
            return;
        }
        if (teams.length < MIN_TEAMS[format]) {
            showError('Add at least ' + MIN_TEAMS[format] + ' teams for the ' +
                FORMAT_LABELS[format].toLowerCase() + ' format.');
            return;
        }

        const tiebreakSelect = $('#tiebreak');
        const tiebreak = tiebreakSelect ? tiebreakSelect.value : 'gd';
        if (tiebreak !== 'gd' && !plan.tiebreaks) {
            showError('Custom tie-break rules are available on the League plan.', true);
            return;
        }

        const tournament = buildTournament(name, sport, format, teams, tiebreak);
        if (saveTournament(tournament)) {
            window.location.href = 'tournament.html?id=' + encodeURIComponent(tournament.id);
        }
    });

    renderTeams();
}


/* ---------- 8. TOURNAMENT PAGE ---------- */

function parseScore(value) {
    if (value === '') return null;
    const number = parseInt(value, 10);
    return (Number.isNaN(number) || number < 0) ? null : number;
}

function buildScoreInput(value) {
    const input = el('input', 'score-input');
    input.type = 'number';
    input.min = '0';
    input.inputMode = 'numeric';
    input.placeholder = '-';
    if (value !== null) input.value = value;
    return input;
}

// Runs when someone types a score
function onScoreChange(tournament, match, homeInput, awayInput) {
    const home = parseScore(homeInput.value);
    const away = parseScore(awayInput.value);
    const hadResult = hasResult(match);

    if (home === null || away === null) {
        match.homeScore = null;
        match.awayScore = null;
        if (!hadResult) return; // only one box filled so far, so wait
    } else {
        match.homeScore = home;
        match.awayScore = away;
    }

    updateTournament(tournament);
    saveTournament(tournament);
    renderTournamentPage(tournament);
}

function buildMatchRow(tournament, match) {
    const row = el('div', 'match');

    // A bye: this team goes straight through
    if (match.bye) {
        row.classList.add('bye');
        row.appendChild(el('span', 'team-name', match.home || match.away));
        row.appendChild(el('span', 'score-divider', 'bye'));
        row.appendChild(el('span', 'team-name', ''));
        return row;
    }

    const homeName = el('span', 'team-name', match.home || 'TBD');
    const awayName = el('span', 'team-name', match.away || 'TBD');
    const homeInput = buildScoreInput(match.homeScore);
    const awayInput = buildScoreInput(match.awayScore);

    // Can't enter a score until both teams are known
    const ready = Boolean(match.home && match.away);
    homeInput.disabled = !ready;
    awayInput.disabled = !ready;
    homeInput.setAttribute('aria-label', 'Score for ' + (match.home || 'home team'));
    awayInput.setAttribute('aria-label', 'Score for ' + (match.away || 'away team'));

    const winner = getWinner(match);
    if (match.stage === 'knockout' && winner) {
        (winner === match.home ? homeName : awayName).classList.add('winner');
    }

    [homeInput, awayInput].forEach(function (input) {
        input.addEventListener('change', function () {
            onScoreChange(tournament, match, homeInput, awayInput);
        });
    });

    row.appendChild(homeName);
    row.appendChild(homeInput);
    row.appendChild(el('span', 'score-divider', '-'));
    row.appendChild(awayInput);
    row.appendChild(awayName);

    // Match time (free for everyone) and reminder button (Club and League)
    const timeInput = el('input', 'match-time');
    timeInput.type = 'datetime-local';
    timeInput.value = match.time || '';
    timeInput.setAttribute('aria-label', 'Match date and time');
    timeInput.addEventListener('change', function () {
        match.time = timeInput.value;
        saveTournament(tournament);
    });
    row.appendChild(timeInput);

    const reminderButton = el('button', 'btn btn-outline btn-small', 'Reminder');
    reminderButton.type = 'button';
    reminderButton.addEventListener('click', function () {
        onReminderClick(tournament, match);
    });
    row.appendChild(reminderButton);

    // Knockout matches can't be draws
    if (match.stage === 'knockout' && hasResult(match) && match.homeScore === match.awayScore) {
        row.classList.add('needs-winner');
        row.appendChild(el('span', 'match-note',
            'Knockout matches need a winner. Include any penalty-shootout goals in the score.'));
    }

    return row;
}

// The names of the rounds in a list of matches, in order, without repeats
function getRoundNames(matches) {
    const names = [];
    matches.forEach(function (match) {
        if (!names.includes(match.roundName)) names.push(match.roundName);
    });
    return names;
}

function appendRounds(container, tournament, matches) {
    getRoundNames(matches).forEach(function (roundName) {
        const round = el('div', 'round');
        round.appendChild(el('h3', '', roundName));
        matches
            .filter(function (match) { return match.roundName === roundName; })
            .forEach(function (match) {
                round.appendChild(buildMatchRow(tournament, match));
            });
        container.appendChild(round);
    });
}

function renderFixtures(tournament) {
    const container = $('#fixtures-container');
    container.innerHTML = '';

    if (tournament.format !== 'groups') {
        appendRounds(container, tournament, tournament.matches);
        return;
    }

    tournament.groups.forEach(function (group) {
        container.appendChild(el('h3', 'group-title', group.name));
        appendRounds(container, tournament, tournament.matches.filter(function (m) {
            return m.stage === 'group' && m.group === group.name;
        }));
    });

    const knockout = tournament.matches.filter(function (m) { return m.stage === 'knockout'; });
    if (knockout.length > 0) {
        container.appendChild(el('h3', 'group-title', 'Knockout stage'));
        appendRounds(container, tournament, knockout);
    } else {
        container.appendChild(el('p', 'tab-note',
            'The knockout stage appears once every group match has a result.'));
    }
}

function buildBracketTeam(match, name, score) {
    const row = el('div', 'bracket-team');
    if (!name) row.classList.add('tbd');
    if (name && getWinner(match) === name) row.classList.add('winner');
    row.appendChild(el('span', '', name || (match.bye ? 'Bye' : 'TBD')));
    row.appendChild(el('span', 'bracket-score', score === null ? '' : String(score)));
    return row;
}

function renderBracket(tournament) {
    const container = $('#bracket-container');
    container.innerHTML = '';
    if (tournament.format === 'round-robin') return;

    const knockout = tournament.matches.filter(function (m) { return m.stage === 'knockout'; });
    if (knockout.length === 0) {
        container.appendChild(el('p', 'tab-note',
            'The bracket appears once every group match has a result.'));
        return;
    }

    getRoundNames(knockout).forEach(function (roundName) {
        const column = el('div', 'bracket-round');
        column.appendChild(el('h3', '', roundName));

        knockout
            .filter(function (match) { return match.roundName === roundName; })
            .forEach(function (match) {
                const box = el('div', 'bracket-match');
                box.appendChild(buildBracketTeam(match, match.home, match.homeScore));
                box.appendChild(buildBracketTeam(match, match.away, match.awayScore));
                column.appendChild(box);
            });

        container.appendChild(column);
    });
}

function buildStandingsTable(rows, qualifyCount) {
    const wrapper = el('div', 'table-wrapper');
    const table = el('table', 'standings-table');

    const headRow = el('tr');
    ['#', 'Team', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].forEach(function (heading) {
        headRow.appendChild(el('th', '', heading));
    });
    const head = el('thead');
    head.appendChild(headRow);
    table.appendChild(head);

    const body = el('tbody');
    rows.forEach(function (row, i) {
        const tr = el('tr');
        if (i < qualifyCount) tr.classList.add('qualified');
        const goalDifference = row.gd > 0 ? '+' + row.gd : String(row.gd);
        [i + 1, row.team, row.p, row.w, row.d, row.l, row.gf, row.ga, goalDifference, row.pts]
            .forEach(function (value) {
                tr.appendChild(el('td', '', String(value)));
            });
        body.appendChild(tr);
    });
    table.appendChild(body);

    wrapper.appendChild(table);
    return wrapper;
}

function renderStandings(tournament) {
    const panel = $('#tab-standings');
    panel.innerHTML = '';
    if (tournament.format === 'knockout') return;

    if (tournament.format === 'round-robin') {
        panel.appendChild(buildStandingsTable(
            computeStandings(tournament.teams, tournament.matches), 0
        ));
        return;
    }

    tournament.groups.forEach(function (group) {
        const groupMatches = tournament.matches.filter(function (m) {
            return m.stage === 'group' && m.group === group.name;
        });
        panel.appendChild(el('h3', 'group-title', group.name));
        panel.appendChild(buildStandingsTable(computeStandings(group.teams, groupMatches), 2));
    });
    panel.appendChild(el('p', 'tab-note', 'The top 2 teams in each group go through to the knockout stage.'));
}


function renderHeader(tournament) {
    const created = new Date(tournament.createdAt).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric'
    });

    $('#tournament-format').textContent = FORMAT_LABELS[tournament.format];
    $('#tournament-title').textContent = tournament.name;
    $('#tournament-meta').textContent = tournament.teams.length + ' teams · ' +
        (SPORT_LABELS[tournament.sport] || 'Other') + ' · Created ' + created;
    document.title = tournament.name + ' | TourneysHQ';

    // Champion banner
    let banner = $('.champion');
    const champion = getChampion(tournament);
    if (champion) {
        if (!banner) {
            banner = el('p', 'champion');
            $('.tournament-header .section-heading').appendChild(banner);
        }
        banner.textContent = '🏆 Champion: ' + champion;
    } else if (banner) {
        banner.remove();
    }
}

function renderTournamentPage(tournament) {
    renderHeader(tournament);
    renderFixtures(tournament);
    renderBracket(tournament);
    renderStandings(tournament);
    renderScorers(tournament);
}

function showTab(name) {
    $$('.tab-btn').forEach(function (button) {
        button.classList.toggle('active', button.dataset.tab === name);
    });
    $$('.tab-panel').forEach(function (panel) {
        panel.classList.toggle('active', panel.id === 'tab-' + name);
    });
}

function setupTabs(tournament) {
    // Round-robin has no bracket. Knockout has no league table.
    const hiddenTab = { 'round-robin': 'bracket', 'knockout': 'standings', 'groups': '' };

    $$('.tab-btn').forEach(function (button) {
        button.hidden = button.dataset.tab === hiddenTab[tournament.format];
        button.addEventListener('click', function () {
            showTab(button.dataset.tab);
        });
    });

    showTab(tournament.format === 'knockout' ? 'bracket' : 'fixtures');
}

function askToUpgrade(featureName) {
    if (confirm(featureName + ' are included in the Club and League plans. View the plans?')) {
        window.location.href = 'index.html#pricing';
    }
}

function initTournamentPage() {
    if (!$('#tournament-title')) return;

    const id = new URLSearchParams(window.location.search).get('id');
    const tournament = getTournament(id);

    if (!tournament) {
        $('#tournament-title').textContent = 'Tournament not found';
        $('#tournament-meta').textContent = 'It may have been deleted, or it was saved on another device.';
        $('.tournament-actions').hidden = true;
        $('.tournament-body').hidden = true;
        return;
    }

    setupTabs(tournament);
    setupScorerForm(tournament);
    renderTournamentPage(tournament);
    startMatchReminders(tournament);

    $('#print-btn').addEventListener('click', function () {
        if (!PLANS[getCurrentPlan()].print) {
            askToUpgrade('Printable reports');
            return;
        }
        window.print();
    });

    $('#share-btn').addEventListener('click', function () {
        if (!PLANS[getCurrentPlan()].share) {
            askToUpgrade('Share-ready graphics');
            return;
        }
        downloadShareGraphic(tournament);
    });
}


/* ---------- 8B. TOP SCORERS ---------- */

function renderScorers(tournament) {
    const body = $('#scorers-body');
    const select = $('#scorer-team');
    const scorers = tournament.scorers || [];

    if (select) {
        const previous = select.value;
        select.innerHTML = '';
        tournament.teams.forEach(function (team) {
            const option = el('option', '', team);
            option.value = team;
            select.appendChild(option);
        });
        if (tournament.teams.includes(previous)) select.value = previous;
    }

    body.innerHTML = '';
    if (scorers.length === 0) {
        const row = el('tr');
        const cell = el('td', '', 'No goals recorded yet. Add them above.');
        cell.colSpan = 4;
        row.appendChild(cell);
        body.appendChild(row);
        return;
    }

    scorers.slice()
        .sort(function (a, b) { return (b.goals - a.goals) || a.name.localeCompare(b.name); })
        .forEach(function (scorer, i) {
            const row = el('tr');
            row.appendChild(el('td', '', String(i + 1)));
            row.appendChild(el('td', '', scorer.name));
            row.appendChild(el('td', '', scorer.team));

            const goalsCell = el('td', '', String(scorer.goals));
            const removeButton = el('button', 'team-remove', '×');
            removeButton.type = 'button';
            removeButton.setAttribute('aria-label', 'Remove ' + scorer.name);
            removeButton.addEventListener('click', function () {
                tournament.scorers = tournament.scorers.filter(function (s) {
                    return !(s.name === scorer.name && s.team === scorer.team);
                });
                saveTournament(tournament);
                renderScorers(tournament);
            });
            goalsCell.appendChild(removeButton);
            row.appendChild(goalsCell);
            body.appendChild(row);
        });
}

function setupScorerForm(tournament) {
    const form = $('#scorer-form');
    if (!form) return;

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        const nameInput = $('#scorer-name');
        const teamSelect = $('#scorer-team');
        const goalsInput = $('#scorer-goals');

        const name = nameInput.value.trim();
        const team = teamSelect.value;
        const goals = parseInt(goalsInput.value, 10);
        if (name === '' || !team || Number.isNaN(goals) || goals < 1) return;

        tournament.scorers = tournament.scorers || [];
        const existing = tournament.scorers.find(function (s) {
            return s.name.toLowerCase() === name.toLowerCase() && s.team === team;
        });
        if (existing) {
            existing.goals += goals;
        } else {
            tournament.scorers.push({ name: name, team: team, goals: goals });
        }

        saveTournament(tournament);
        nameInput.value = '';
        goalsInput.value = '1';
        renderScorers(tournament);
        nameInput.focus();
    });
}

/* ---------- 8C. MATCH REMINDERS (Club and League) ---------- */

function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
}

function onReminderClick(tournament, match) {
    if (!PLANS[getCurrentPlan()].reminders) {
        askToUpgrade('Match reminders');
        return;
    }
    if (!match.time) {
        alert('Set a date and time for this match first.');
        return;
    }
    downloadMatchCalendarFile(tournament, match);
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Calendar files use UTC times, such as 20261120T140000Z
function formatIcsDate(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Calendar text needs commas and semicolons escaped
function escapeIcs(text) {
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/[;,]/g, '\\$&')
        .replace(/\n/g, '\\n');
}

// Builds a .ics file: a calendar event with an alarm 30 minutes before
function downloadMatchCalendarFile(tournament, match) {
    const start = new Date(match.time);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const matchName = (match.home || 'Home') + ' vs ' + (match.away || 'Away');
    const uid = [tournament.id, match.stage, match.group, match.round, match.index].join('-') + '@tourneyshq';

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//TourneysHQ//EN',
        'BEGIN:VEVENT',
        'UID:' + uid,
        'DTSTAMP:' + formatIcsDate(new Date()),
        'DTSTART:' + formatIcsDate(start),
        'DTEND:' + formatIcsDate(end),
        'SUMMARY:' + escapeIcs(matchName + ' (' + tournament.name + ')'),
        'DESCRIPTION:' + escapeIcs(match.roundName + ' · ' + FORMAT_LABELS[tournament.format]),
        'BEGIN:VALARM',
        'TRIGGER:-PT30M',
        'ACTION:DISPLAY',
        'DESCRIPTION:' + escapeIcs(matchName + ' starts in 30 minutes'),
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR'
    ];

    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = slugify(tournament.name) + '-' + slugify(matchName) + '.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// While a tournament page is open, show a browser notification 30 minutes before each match
function startMatchReminders(tournament) {
    if (!PLANS[getCurrentPlan()].reminders) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const alreadySent = new Set();

    function checkMatches() {
        const now = Date.now();
        tournament.matches.forEach(function (match) {
            if (!match.time || match.bye || !match.home || !match.away) return;
            const minutesLeft = (new Date(match.time).getTime() - now) / 60000;
            const key = [match.stage, match.group, match.round, match.index].join('-');
            if (minutesLeft > 0 && minutesLeft <= 30 && !alreadySent.has(key)) {
                alreadySent.add(key);
                new Notification('Match in 30 minutes', {
                    body: match.home + ' vs ' + match.away + ' · ' + tournament.name
                });
            }
        });
    }

    checkMatches();
    setInterval(checkMatches, 60 * 1000);
}

/* ---------- 8D. SHARE GRAPHIC (Club and League) ---------- */

function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function drawStandingsTable(ctx, rows, startY, padding) {
    const columns = [
        { label: 'P', x: 680, key: 'p' },
        { label: 'W', x: 760, key: 'w' },
        { label: 'D', x: 840, key: 'd' },
        { label: 'L', x: 920, key: 'l' },
        { label: 'Pts', x: 1010, key: 'pts' }
    ];

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = '#64748b';
    columns.forEach(function (c) { ctx.fillText(c.label, c.x, startY + 24); });

    rows.forEach(function (row, i) {
        const y = startY + 60 + i * 56;
        ctx.textAlign = 'left';
        ctx.font = '28px system-ui, sans-serif';
        ctx.fillStyle = '#0f172a';
        ctx.fillText((i + 1) + '.  ' + truncate(row.team, 26), padding, y);

        ctx.textAlign = 'center';
        columns.forEach(function (c) {
            ctx.font = c.key === 'pts' ? 'bold 28px system-ui, sans-serif' : '28px system-ui, sans-serif';
            ctx.fillText(String(row[c.key]), c.x, y);
        });
    });

    return startY + 60 + rows.length * 56 + 24;
}

function downloadShareGraphic(tournament) {
    const padding = 72;
    const width = 1080;
    const champion = getChampion(tournament);

    // Collect what to draw first, so the picture can be sized to fit
    const sections = [];
    if (tournament.format === 'knockout') {
        tournament.matches.filter(hasResult).forEach(function (m) {
            sections.push({
                type: 'text',
                text: m.roundName + ':  ' + m.home + '  ' + m.homeScore + ' - ' + m.awayScore + '  ' + m.away
            });
        });
    } else if (tournament.format === 'round-robin') {
        sections.push({
            type: 'table',
            rows: computeStandings(tournament.teams, tournament.matches, tournament.tiebreak)
        });
    } else {
        tournament.groups.forEach(function (group) {
            const groupMatches = tournament.matches.filter(function (m) {
                return m.stage === 'group' && m.group === group.name;
            });
            sections.push({ type: 'title', text: group.name });
            sections.push({
                type: 'table',
                rows: computeStandings(group.teams, groupMatches, tournament.tiebreak)
            });
        });
    }

    let height = 300;
    sections.forEach(function (s) {
        if (s.type === 'title') height += 72;
        else if (s.type === 'text') height += 48;
        else height += 60 + s.rows.length * 56 + 24;
    });
    height += 120;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, width, 240);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px system-ui, sans-serif';
    ctx.fillText(truncate(tournament.name, 34), padding, 100);

    ctx.font = '30px system-ui, sans-serif';
    ctx.fillStyle = '#ccfbf1';
    ctx.fillText(FORMAT_LABELS[tournament.format] + ' · ' + tournament.teams.length + ' teams', padding, 150);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText(champion ? '🏆 Champion: ' + truncate(champion, 30) : 'Tournament in progress', padding, 205);

    let y = 300;
    sections.forEach(function (s) {
        if (s.type === 'title') {
            ctx.fillStyle = '#0f766e';
            ctx.font = 'bold 36px system-ui, sans-serif';
            ctx.fillText(s.text, padding, y + 36);
            y += 72;
        } else if (s.type === 'text') {
            ctx.fillStyle = '#334155';
            ctx.font = '28px system-ui, sans-serif';
            ctx.fillText(truncate(s.text, 62), padding, y + 28);
            y += 48;
        } else {
            y = drawStandingsTable(ctx, s.rows, y, padding);
        }
    });

    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748b';
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillText('Made with TourneysHQ', padding, height - 50);

    canvas.toBlob(function (blob) {
        if (!blob) {
            alert('Sorry, the graphic could not be created.');
            return;
        }
        const file = new File([blob], slugify(tournament.name) + '.png', { type: 'image/png' });

        // On phones this opens the share sheet (WhatsApp, Instagram and so on)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: tournament.name }).catch(function () {});
            return;
        }

        const url = URL.createObjectURL(blob);
        const link = el('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }, 'image/png');
}

/* ---------- 11. EXTRAS ON EVERY PAGE: dark mode and mobile menu ---------- */

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
}

function initSiteChrome() {
    const header = $('.site-header');
    if (!header) return;

    let savedTheme = 'light';
    try {
        savedTheme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch (error) {
        // storage blocked, so stay on light mode
    }
    applyTheme(savedTheme);

    // Mobile menu button (hidden on wide screens by CSS)
    const menuButton = el('button', 'menu-toggle', '☰ Menu');
    menuButton.type = 'button';
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.addEventListener('click', function () {
        const open = header.classList.toggle('nav-open');
        menuButton.setAttribute('aria-expanded', String(open));
    });
    $('.logo', header).after(menuButton);

    // Close the menu once a link is picked
    header.addEventListener('click', function (event) {
        if (event.target.closest('.main-nav a')) {
            header.classList.remove('nav-open');
            menuButton.setAttribute('aria-expanded', 'false');
        }
    });

    // Dark mode button
    const themeButton = el('button', 'theme-toggle');
    themeButton.type = 'button';

    function paintThemeButton() {
        const dark = document.documentElement.dataset.theme === 'dark';
        themeButton.textContent = dark ? '☀ Light' : '☾ Dark';
        themeButton.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    }

    themeButton.addEventListener('click', function () {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try {
            localStorage.setItem(THEME_KEY, next);
        } catch (error) {
            // could not save, but the change still applies for this visit
        }
        paintThemeButton();
    });

    paintThemeButton();
    header.appendChild(themeButton);
}


/* ---------- 9. CHECKOUT PAGE (pretend payment) ---------- */

// Shows a message on a form box using the browser's built-in popup
function complain(input, message) {
    input.setCustomValidity(message);
    input.reportValidity();
    input.addEventListener('input', function () {
        input.setCustomValidity('');
    }, { once: true });
}

function initCheckout() {
    const form = $('#checkout-form');
    if (!form) return;

    const params = new URLSearchParams(window.location.search);
    let planKey = params.get('plan');
    if (!PLANS[planKey] || planKey === 'free') planKey = 'club';
    const plan = PLANS[planKey];

    const billingSelect = $('#billing-select');
    billingSelect.value = params.get('billing') === 'annual' ? 'annual' : 'monthly';

    function updateSummary() {
        const billing = billingSelect.value;
        $('#summary-plan').textContent = plan.name + ' plan';
        $('#summary-price').textContent = formatNumber(plan[billing]);
        $('.summary-price .period').textContent = billing === 'annual' ? '/month, billed yearly' : '/month';
    }

    updateSummary();
    billingSelect.addEventListener('change', updateSummary);

    const cardInput = $('#card-number');
    const expiryInput = $('#card-expiry');
    const cvcInput = $('#card-cvc');

    // Tidy the typing: card as "1234 5678 9012 3456", expiry as "MM/YY"
    cardInput.addEventListener('input', function () {
        cardInput.value = cardInput.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
    });

    expiryInput.addEventListener('input', function () {
        const digits = expiryInput.value.replace(/\D/g, '').slice(0, 4);
        expiryInput.value = digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
    });

    cvcInput.addEventListener('input', function () {
        cvcInput.value = cvcInput.value.replace(/\D/g, '').slice(0, 4);
    });

    form.addEventListener('submit', function (event) {
        event.preventDefault();

        if (cardInput.value.replace(/\s/g, '').length !== 16) {
            complain(cardInput, 'Enter a 16-digit number (demo only, please do not use a real card).');
            return;
        }
        if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiryInput.value)) {
            complain(expiryInput, 'Use the format MM/YY.');
            return;
        }
        if (cvcInput.value.length < 3) {
            complain(cvcInput, 'Enter the 3 or 4 digit CVC.');
            return;
        }

        // Remember the plan on this device
        setCurrentPlan(planKey, billingSelect.value);

        const success = $('#checkout-success');
        $('p', success).textContent = 'Your ' + plan.name + ' plan is now active on this device.';
        $('.checkout-layout').hidden = true;
        success.hidden = false;
        window.scrollTo(0, 0);
    });
}


/* ---------- 10. START EVERYTHING ---------- */

document.addEventListener('DOMContentLoaded', function () {
    initPricingToggle();
    initTournamentsPage();
    initCreatePage();
    initTournamentPage();
    initCheckout();
    lockPlanOptions();
    initSiteChrome();
});


/* ---------- 16. PLAN OPTIONS ON THE CREATE PAGE ---------- */

// Greys out tie-break choices the current plan does not include
function lockPlanOptions() {
    const tiebreak = $('#tiebreak');
    if (!tiebreak) return;
    const allowed = PLANS[getCurrentPlan()].tiebreaks;
    $$('option', tiebreak).forEach(function (option) {
        option.disabled = option.value !== 'gd' && !allowed;
    });
}