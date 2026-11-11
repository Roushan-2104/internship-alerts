// Student preferences: what the new form offers, and how each job is checked against them.

var CHOICES = {
  ROLE_TYPES: [
    ['Internships', 'internship'],
    ['Apprenticeships and trainee roles', 'apprentice'],
    ['New-grad full-time roles', 'newGrad'],
    ['Student research roles', 'research'],
    ['Part-time or contract roles (student-level)', 'partTime']
  ],
  LOCATIONS: [
    ['Bengaluru', /bengaluru|bangalore/i],
    ['Hyderabad', /hyderabad/i],
    ['Pune', /\bpune\b/i],
    ['Mumbai', /mumbai|thane/i],
    ['Delhi NCR (including Gurugram and Noida)', /delhi|gurugram|gurgaon|noida|\bncr\b|faridabad|ghaziabad/i],
    ['Chennai', /chennai/i],
    ['Kolkata', /kolkata/i],
    ['Ahmedabad', /ahmedabad/i],
    ['Other Indian city', null],
    ['Remote (open to India)', null]
  ],
  AREAS: ['Engineering', 'Data and AI', 'Design', 'Product', 'Marketing', 'Sales and business', 'Operations', 'Finance', 'People (HR)', 'Hardware', 'Research', 'Legal'],
  FREQUENCY: [['Daily', 'daily'], ['Weekly (Sundays)', 'weekly']]
};

function splitList_(value) {
  return (Array.isArray(value) ? value : String(value || '').split(/[,;\n]+/))
    .map(function (item) { return String(item).trim(); }).filter(String);
}

function companyKey_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function companyListed_(company, names) {
  var key = companyKey_(company);
  return names.some(function (name) {
    var wanted = companyKey_(name);
    return wanted && (key === wanted || (wanted.length >= 4 && key.indexOf(wanted) === 0));
  });
}

/** Maps form labels to the role type codes the watcher uses. */
function roleCodes_(labels) {
  return splitList_(labels).map(function (label) {
    var found = CHOICES.ROLE_TYPES.filter(function (pair) { return pair[0] === label || pair[1] === label; })[0];
    return found ? found[1] : '';
  }).filter(String);
}

function areaKey_(label) {
  return String(label).toLowerCase().replace(' (hr)', '');
}

function locationFits_(job, chosen) {
  var place = String(job.location || '');
  var remote = isTrue_(job.remote);
  if (remote && chosen.indexOf('Remote (open to India)') !== -1) return true;
  var cities = CHOICES.LOCATIONS.filter(function (pair) { return pair[1]; });
  var namedCities = cities.filter(function (pair) { return pair[1].test(place); });
  // "India" with no city could be anywhere, so it fits any city choice.
  if (!namedCities.length) {
    var anyCity = chosen.some(function (label) { return label !== 'Remote (open to India)'; });
    return anyCity && (!remote || /india/i.test(place));
  }
  if (namedCities.some(function (pair) { return chosen.indexOf(pair[0]) !== -1; })) return true;
  return false;
}

/**
 * Checks a job against a student's preferences. Blank preferences allow everything.
 * "never" is absolute. "always" overrides the other choices.
 */
function preferenceCheck_(job, student) {
  if (companyListed_(job.company, splitList_(student.excludeCompanies))) return { ok: false, absolute: true, always: false, reason: 'Company excluded by the student' };
  if (companyListed_(job.company, splitList_(student.includeCompanies))) return { ok: true, absolute: false, always: true, reason: '' };

  var roles = roleCodes_(student.roleTypes);
  if (roles.length) {
    var role = job.roleType || 'internship';
    if (roles.indexOf(role) === -1) return { ok: false, absolute: false, always: false, reason: 'Role type not chosen' };
    if (isTrue_(job.partTime) && roles.indexOf('partTime') === -1) return { ok: false, absolute: false, always: false, reason: 'Part-time not chosen' };
  }
  var places = splitList_(student.locations);
  if (places.length && !locationFits_(job, places)) return { ok: false, absolute: false, always: false, reason: 'Location not chosen' };
  var areas = splitList_(student.areas).map(areaKey_);
  if (areas.length) {
    var jobAreas = splitList_(job.areas).map(function (area) { return area.toLowerCase(); });
    var overlap = jobAreas.some(function (area) { return areas.indexOf(area) !== -1; });
    if (jobAreas.length && jobAreas.indexOf('other') === -1 && !overlap) return { ok: false, absolute: false, always: false, reason: 'Area not chosen' };
  }
  return { ok: true, absolute: false, always: false, reason: '' };
}
