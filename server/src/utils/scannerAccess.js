// Which scanners a person may be on (Employee.allowedScanners): no list means
// every scanner, a list means only those — an empty one, none. Everything that
// puts someone on a scanner goes through this (utils/deviceSync.js).
function allowsScanner(employee, serialNumber) {
  return !Array.isArray(employee?.allowedScanners) || employee.allowedScanners.includes(serialNumber);
}

module.exports = { allowsScanner };
