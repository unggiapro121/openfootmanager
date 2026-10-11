//! Seating players in formation slots so the lineup as a whole is strongest.
//!
//! Filling slots one at a time — the best player for the keeper's slot, then
//! the best of the rest for left-back, and so on — spends a star on the first
//! slot he is good enough for, however much better he would be further up the
//! pitch. Choosing every slot at once is the assignment problem; the Hungarian
//! method solves it exactly, and for eleven slots and a squad it is instant.

/// For each row (slot), the column (player) it takes, maximising the summed
/// `weights[row][column]`. Every row gets a distinct column; needs at least as
/// many columns as rows, and returns an empty assignment otherwise.
pub(crate) fn best_assignment(weights: &[Vec<f64>]) -> Vec<usize> {
    let rows = weights.len();
    let columns = weights.first().map_or(0, Vec::len);
    if rows == 0 || columns < rows || weights.iter().any(|row| row.len() != columns) {
        return Vec::new();
    }

    // Minimum-cost form on negated weights; potentials `u`, `v` and the
    // matching `way`/`matched` are 1-indexed, with index 0 as the free sentinel.
    let cost = |row: usize, column: usize| -weights[row - 1][column - 1];
    let mut u = vec![0.0; rows + 1];
    let mut v = vec![0.0; columns + 1];
    let mut matched = vec![0usize; columns + 1];
    let mut way = vec![0usize; columns + 1];

    for row in 1..=rows {
        matched[0] = row;
        let mut column0 = 0usize;
        let mut min_to = vec![f64::INFINITY; columns + 1];
        let mut used = vec![false; columns + 1];
        loop {
            used[column0] = true;
            let row0 = matched[column0];
            let mut delta = f64::INFINITY;
            let mut column1 = 0usize;
            for column in 1..=columns {
                if used[column] {
                    continue;
                }
                let reduced = cost(row0, column) - u[row0] - v[column];
                if reduced < min_to[column] {
                    min_to[column] = reduced;
                    way[column] = column0;
                }
                if min_to[column] < delta {
                    delta = min_to[column];
                    column1 = column;
                }
            }
            for column in 0..=columns {
                if used[column] {
                    u[matched[column]] += delta;
                    v[column] -= delta;
                } else {
                    min_to[column] -= delta;
                }
            }
            column0 = column1;
            if matched[column0] == 0 {
                break;
            }
        }
        loop {
            let column1 = way[column0];
            matched[column0] = matched[column1];
            column0 = column1;
            if column0 == 0 {
                break;
            }
        }
    }

    let mut assignment = vec![0usize; rows];
    for column in 1..=columns {
        if matched[column] != 0 {
            assignment[matched[column] - 1] = column - 1;
        }
    }
    assignment
}

#[cfg(test)]
mod tests {
    use super::best_assignment;

    fn total(weights: &[Vec<f64>], assignment: &[usize]) -> f64 {
        assignment
            .iter()
            .enumerate()
            .map(|(row, column)| weights[row][*column])
            .sum()
    }

    /// Given a star who is good anywhere but best up front, and two others who
    /// are only good in their own slot, then the star goes up front: filling
    /// the first slot greedily would have spent him at the back.
    #[test]
    fn the_whole_lineup_is_strongest_not_the_first_slot() {
        // Rows: back slot, front slot. Columns: star, defender, midfielder.
        let weights = vec![vec![70.0, 65.0, 40.0], vec![95.0, 30.0, 60.0]];

        let assignment = best_assignment(&weights);

        assert_eq!(assignment, vec![1, 0]);
        assert_eq!(total(&weights, &assignment), 160.0);
    }

    /// Given every permutation of a small square case, then no other assignment
    /// beats the one returned.
    #[test]
    fn no_other_assignment_is_better() {
        let weights = vec![
            vec![9.0, 2.0, 7.0, 8.0],
            vec![6.0, 4.0, 3.0, 7.0],
            vec![5.0, 8.0, 1.0, 8.0],
            vec![7.0, 6.0, 9.0, 4.0],
        ];
        let best = total(&weights, &best_assignment(&weights));
        let mut columns = [0, 1, 2, 3];
        let mut brute: f64 = 0.0;
        permute(&mut columns, 0, &mut |order| {
            brute = brute.max(total(&weights, order))
        });

        assert_eq!(best, brute);
    }

    /// Given fewer columns than rows, then there is no assignment.
    #[test]
    fn too_few_players_assigns_nothing() {
        assert!(best_assignment(&[vec![1.0], vec![2.0]]).is_empty());
    }

    fn permute(items: &mut [usize; 4], start: usize, visit: &mut impl FnMut(&[usize])) {
        if start == items.len() {
            visit(items);
            return;
        }
        for index in start..items.len() {
            items.swap(start, index);
            permute(items, start + 1, visit);
            items.swap(start, index);
        }
    }
}
