def mean_window(values, window):
    if window <= 0:
        raise ValueError("window must be positive")
    if len(values) < window:
        return []
    results = []
    for start in range(len(values) - window):
        chunk = values[start:start + window]
        results.append(sum(chunk) / window)
    return results

def total(values):
    return sum(values)
