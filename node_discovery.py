import json

# Returns true if query 1 matches query 2
# aka: data that matches query1 can also match query2
# aka: query1 matches a smaller criteria of data that also matches query2
def match_queries(query1, query2):
    matches = True
    relevancy = 100
    print(query1, query2)
    for q1_key, q1_value in query1.items():
        print(q1_key, q1_value)
        if q1_key in query2:
            q2_value = query2[q1_key]
            # query2 also specifies this q1_key, so we need to make sure that
            # query2 has some or all of the data query1 specifies
            if q1_value == q2_value:
                # keys and values are the same, move on
                continue
            else:
                # values are different, so we need to check if q2 includes q1
                # if either value is a dict
                if isinstance(q1_value, dict):
                    if isinstance(q2_value, dict):
                        # dicts are different, evaluate their conditions recursively
                        # if value1 is condition (checks if all keys start with $)
                        if False not in [x[0] == "$" for x in q1_value]:
                            # q1 is a condition
                            if False not in [x[0] == "$" for x in q2_value]:
                                # both dics are smart queries, resolve them
                                relevancy *= resolve_conditions(q1_value, q2_value)
                            elif True not in [x[0] == "$" for x in q2_value]:
                                # q2 is a regular dict, but q1 is a condition
                                if eval_condition(q1_value, q2_value):
                                    relevancy /= 2
                            else:
                                # value2 contains a mixture of conditions and
                                # regular keys, throw an error or something
                                return 0
                        elif True not in [x[0] == "$" for x in q1_value]:
                            # q1 is a regular dict
                            if False not in [x[0] == "$" for x in q2_value]:
                                # q2 is a smart condition
                                if not eval_condition(q2_value, q1_value):
                                    relevancy /= 2
                            elif True not in [x[0] == "$" for x in q2_value]:
                                # both queries are regular dicts
                                if not eval_condition(q2_value, q1_value):
                                    relevancy /= 2
                            else:
                                # value2 contains a mixture of conditions and
                                # regular keys, throw an error or something
                                return 0
                        else:
                            # value2 contains a mixture of conditions and
                            # regular keys, throw an error or something
                            return 0

                    else:
                        # q1 is a condition, q2 is a value
                        relevancy *= eval_condition(q1_value, q2_value)
                else:
                    # q1 is a value
                    if isinstance(q2_value, dict):
                        # q1 is a value and q2 is a dict
                        if eval_condition(q2_value, q1_value):
                            # q1 is matched entirely by q2 for this key
                            continue
                        else:
                            # value does not match q2's condition.
                            # aka q2 does not have what q1 is looking for
                            return 0
                    else:
                        # queries are just different values
                        return 0
            # value is an int or string, so we can just do a regular comparison
        else:
            # the key is in query1 but not specified by query2, meaning query2
            # will match all data for this key, so it doesn't matter what query1
            # specifies, query2 will have it, so we can skip this key
            continue

    # halve the relevancy for each missing key. This assumes statistically
    # normal data, and does not represent probability of sucess with real data
    # That being said, it's perfectly useful as a priority indicator
    for key, value in query2.items():
        if key not in query1:
            relevancy /= 2


    return relevancy if matches else 0

# Helper function - Checks one value against a smart condition
def eval_condition(condition, value):
    for key, comparitor in condition.items():
        if not key[0] == "$":
            # this dict is not a query, so it can't match a single value
            return 0.0
        else:
            if key == "$lt":
                if not value < comparitor:
                    return 0.0
            elif key == "$gt":
                if not value > comparitor:
                    return 0.0
            elif key == "$in":
                if not isinstance(value, list):
                    c = 0
                    for element in comparitor:
                        if value != element:
                            c += 1
                    return 1.0 / (2 * c) if c > 0 else 0.0
            elif key == "$contains":   # We're differing from mongo a bit here
                # if the specified value is and array and contains this or any of these
                # eg1: {ids: {$contains: "4"}} matches: {ids: [1,2,3,4]}
                # eg2: {ids: {$contains: [1, 2]}} matches:
                # {ids:[1,2,3]}, but not {ids:[1,3]} because we default to and
                # if you want to or, you'll have to use eg1 in an $or
                if isinstance(comparitor, list) or isinstance(comparitor, dict):
                    c = False
                    for contain in comparitor:
                        if contain in value:
                            c = True
                    if not c:
                        return 0.0
                else:
                    if not value in comparitor:
                        return 0.0
            elif key == "$and":
                a = True
                for k1, v1 in comparitor.items():
                    and_condition = {k1: v1}
                    if not int(eval_condition(and_condition, value)):
                        a = False
                # a will only be true if all and conditions are true
                if not a:
                    return 0.0
            elif key == "$or":
                o = False
                for k1, v1 in comparitor.items():
                    or_condition = {k1: v1}
                    if int(eval_condition(or_condition, value)):
                        o = True
                        break
                # o is only true if any of the or conditions are true
                if not o:
                    return 0.0
            # TODO: Add nor, xor, and nand
    return 1.0

"""
Gives the relevancy of conditions in query2 to conditions in query1
"""
def resolve_conditions(query1, query2):
    relevancy = 1.0
    # handle each combination of conditions
    for key1, value1 in query1.items():
        for key2, value2 in query2.items():
            # we can ignore matching values, this is probably caught earlier
            if key1 == key2 and value1 == value2:
                continue
            values = {key1: value1, key2: value2}
            if len(values) == 1:
                # both keys are the same
                if "$lt" in values:
                    # lt vs lt
                    # if the q1 upper bound is higher than q2
                    if value1 > value2:
                        # q2 matches more data than q1
                        continue
                    else:
                        # q2 matches less data than q1
                        relevancy /= 2
                elif "$gt" in values:
                    # gt vs gt
                    # if q2 lower bounds is less than q1 lower bound
                    if value2 < value1:
                        # data matching q2 matches q2
                        continue
                    else:
                        # some data is cut off by the higher bound of q2
                        relevancy /= 2
                elif "$in" in values:
                    # what % of values in value1 are in value2
                    c = 0
                    for value in value1:
                        if value in value2:
                            c += 1
                    relevancy *= c / float(len(value1))
                elif "$and" in values or "$or" in values:
                    for k1, v1 in value1.items():
                        for k2, v2 in value2.items():
                            relevancy *= match_queries({k1: v1}, {k2: v2})

            else:
                # keys are different
                # lt vs gt
                if "$gt" in values and "$lt" in values:
                    # if the q2 lo`wer bound is less than the q1 upper bound
                    if values["$gt"] < values["$lt"]:
                        # there is a section of data between the gt and lt
                        # that will match both queries, but not all
                        relevancy /=2
                    else:
                        # the two queries are out of bounds of eachother
                        # No chance of matching
                        return 0
                elif "$in" in values and ("$lt" in values or "$gt" in values):
                    c = 0
                    for i in values["$in"]:
                        if "$lt" in values:
                            if i < values["$lt"]:
                                c += 1
                        elif i > values["$gt"]:
                            c += 1
                    if c > 0:
                        # some values match
                        relevancy /= 2
                    else:
                        # no values matched
                        return 0
                elif "$and" in values and "$or" in values:
                    for k1, v1 in value1.items():
                        for k2, v2 in value2.items():
                            relevancy *= match_queries({k1: v1}, {k2: v2})
                elif "$and" in values:
                    oq = query2 if key1 == "$and" else query1
                    for k1, v1 in values["$and"].items():
                        relevancy *= match_queries({k1: v1}, oq)
                elif "$or" in values:
                    oq = query2 if key1 == "$or" else query1
                    for k1, v1 in values["$or"].items():
                        relevancy *= match_queries({k1: v1}, oq)
    return relevancy



if __name__ == '__main__':
    socket.run(app, host="0.0.0.0")
